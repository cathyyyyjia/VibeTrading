from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from fastapi import Header
from jwt import PyJWKClient, decode as jwt_decode

from app.core.config import settings
from app.core.errors import AppError


def _b64url_decode(data: str) -> bytes:
  padding = "=" * (-len(data) % 4)
  return base64.urlsafe_b64decode(data + padding)


def _b64url_encode(data: bytes) -> str:
  return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def verify_hs256_jwt(token: str, secret: str) -> dict[str, Any]:
  parts = token.split(".")
  if len(parts) != 3:
    raise AppError("UNAUTHORIZED", "Invalid token format")

  header_b64, payload_b64, sig_b64 = parts
  try:
    header = json.loads(_b64url_decode(header_b64).decode("utf-8"))
    payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
  except Exception:
    raise AppError("UNAUTHORIZED", "Invalid token encoding")

  if header.get("alg") != "HS256":
    raise AppError("UNAUTHORIZED", "Unsupported token algorithm", {"alg": header.get("alg")})

  signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
  expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
  expected_b64 = _b64url_encode(expected)
  if not hmac.compare_digest(expected_b64, sig_b64):
    raise AppError("UNAUTHORIZED", "Invalid token signature")

  exp = payload.get("exp")
  if isinstance(exp, (int, float)) and int(time.time()) >= int(exp):
    raise AppError("UNAUTHORIZED", "Token expired")

  return payload

def verify_jwks_jwt(token: str, jwks_base_url: str) -> dict[str, Any]:
  try:
    client = PyJWKClient(jwks_base_url.rstrip("/") + "/auth/v1/keys")
    signing_key = client.get_signing_key_from_jwt(token)
    payload = jwt_decode(
      token,
      key=signing_key.key,
      algorithms=["RS256", "ES256"],
      options={"verify_aud": False},
    )
  except Exception as e:
    raise AppError("UNAUTHORIZED", "Invalid token signature", {"error": str(e)})

  exp = payload.get("exp")
  if isinstance(exp, (int, float)) and int(time.time()) >= int(exp):
    raise AppError("UNAUTHORIZED", "Token expired")

  return payload

def _decode_jwt_payload(token: str) -> dict[str, Any]:
  parts = token.split(".")
  if len(parts) != 3:
    raise AppError("UNAUTHORIZED", "Invalid token format")
  _, payload_b64, _ = parts
  try:
    payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
  except Exception:
    raise AppError("UNAUTHORIZED", "Invalid token payload")
  exp = payload.get("exp")
  if isinstance(exp, (int, float)) and int(time.time()) >= int(exp):
    raise AppError("UNAUTHORIZED", "Token expired")
  return payload

def _extract_bearer_token(authorization: str | None) -> str | None:
  if not authorization:
    return None
  if not authorization.startswith("Bearer "):
    return None
  token = authorization.removeprefix("Bearer ").strip()
  if token in ("", "undefined", "null"):
    return None
  return token


async def get_auth_claims(authorization: str | None = Header(default=None)) -> tuple[str, dict[str, Any]]:
  token = _extract_bearer_token(authorization)
  if token is None:
    raise AppError("UNAUTHORIZED", "Missing bearer token")

  alg = "unknown"
  try:
    header_b64 = token.split(".")[0]
    alg = json.loads(_b64url_decode(header_b64).decode("utf-8")).get("alg", "unknown")
  except Exception:
    pass

  if alg in ("RS256", "ES256") and settings.supabase_project_url:
    try:
      return "supabase", verify_jwks_jwt(token, settings.supabase_project_url)
    except AppError:
      if settings.app_env == "local":
        return "supabase", _decode_jwt_payload(token)
      raise

  if alg == "HS256" and settings.supabase_jwt_secret:
    try:
      return "supabase", verify_hs256_jwt(token, settings.supabase_jwt_secret)
    except AppError:
      if settings.app_env == "local":
        return "supabase", _decode_jwt_payload(token)
      raise

  if alg == "HS256" and settings.oauth_jwt_secret:
    try:
      return "oauth", verify_hs256_jwt(token, settings.oauth_jwt_secret)
    except AppError:
      if settings.app_env == "local":
        return "oauth", _decode_jwt_payload(token)
      raise

  if settings.supabase_project_url:
    try:
      return "supabase", verify_jwks_jwt(token, settings.supabase_project_url)
    except AppError:
      pass

  raise AppError("UNAUTHORIZED", "Unsupported token algorithm", {"alg": alg})
