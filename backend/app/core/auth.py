from __future__ import annotations

import time
import logging
import json
from collections import OrderedDict
from typing import Any

import httpx
import jwt
from fastapi import Request
from jwt import InvalidTokenError, PyJWK

from app.core.config import settings
from app.core.errors import AppError, error_response

_TOKEN_CACHE_TTL_SECONDS = 60.0
_token_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
_jwks_cache: tuple[float, dict[str, Any]] = (0.0, {})
_SUPPORTED_JWT_ALGS = {"RS256", "ES256", "EdDSA", "HS256"}
logger = logging.getLogger(__name__)


def _token_cache_capacity() -> int:
  return max(1, int(settings.auth_token_cache_max_entries))


def _token_cache_get(token: str) -> dict[str, Any] | None:
  cached = _token_cache.get(token)
  if cached is None:
    return None
  expires_at, claims = cached
  if expires_at <= time.monotonic():
    _token_cache.pop(token, None)
    return None
  _token_cache.move_to_end(token)
  return claims


def _token_cache_set(token: str, claims: dict[str, Any]) -> None:
  now = time.monotonic()
  _token_cache[token] = (now + _TOKEN_CACHE_TTL_SECONDS, claims)
  _token_cache.move_to_end(token)

  # Evict least recently used tokens first when exceeding capacity.
  capacity = _token_cache_capacity()
  while len(_token_cache) > capacity:
    _token_cache.popitem(last=False)

  # Opportunistically drop expired entries from the LRU side.
  while _token_cache:
    oldest_expires_at = next(iter(_token_cache.values()))[0]
    if oldest_expires_at > now:
      break
    _token_cache.popitem(last=False)


def _extract_bearer_token(authorization: str | None) -> str | None:
  if not authorization:
    return None
  if not authorization.startswith("Bearer "):
    return None
  token = authorization.removeprefix("Bearer ").strip()
  if token in ("", "undefined", "null"):
    return None
  return token


async def verify_supabase_userinfo(token: str) -> dict[str, Any]:
  cached = _token_cache_get(token)
  if cached is not None:
    return cached

  if not settings.supabase_project_url:
    raise AppError("CONFIG_ERROR", "SUPABASE_PROJECT_URL is required")
  if not settings.supabase_secret_key:
    raise AppError("CONFIG_ERROR", "SUPABASE_SECRET_KEY is required")

  url = settings.supabase_project_url.rstrip("/") + "/auth/v1/user"
  headers = {
    "apikey": settings.supabase_secret_key,
    "Authorization": f"Bearer {token}",
  }
  try:
    async with httpx.AsyncClient(timeout=10) as client:
      resp = await client.get(url, headers=headers)
  except Exception as e:
    raise AppError("UNAUTHORIZED", "Token verification failed", {"error": str(e)})

  if resp.status_code != 200:
    raise AppError(
      "UNAUTHORIZED",
      "Invalid token",
      {"status_code": resp.status_code, "body": resp.text[:300]},
      http_status=401,
    )

  user = resp.json()
  user_id = user.get("id")
  if not isinstance(user_id, str) or not user_id:
    raise AppError("UNAUTHORIZED", "Invalid token payload", {"reason": "missing user id"}, http_status=401)

  claims: dict[str, Any] = {
    "sub": user_id,
    "email": user.get("email"),
    "role": user.get("role"),
    "app_metadata": user.get("app_metadata") if isinstance(user.get("app_metadata"), dict) else {},
    "user_metadata": user.get("user_metadata") if isinstance(user.get("user_metadata"), dict) else {},
  }
  _token_cache_set(token, claims)
  return claims


def _normalized_jwt_claims(claims: dict[str, Any]) -> dict[str, Any]:
  return {
    "sub": claims.get("sub"),
    "email": claims.get("email"),
    "role": claims.get("role"),
    "app_metadata": claims.get("app_metadata") if isinstance(claims.get("app_metadata"), dict) else {},
    "user_metadata": claims.get("user_metadata") if isinstance(claims.get("user_metadata"), dict) else {},
    "name": claims.get("name"),
  }


def _expected_jwt_issuer() -> str:
  if settings.supabase_jwt_issuer:
    return settings.supabase_jwt_issuer.rstrip("/")
  if not settings.supabase_project_url:
    raise AppError("CONFIG_ERROR", "SUPABASE_PROJECT_URL or SUPABASE_JWT_ISSUER is required")
  return settings.supabase_project_url.rstrip("/") + "/auth/v1"


def _jwks_url() -> str:
  if not settings.supabase_project_url:
    raise AppError("CONFIG_ERROR", "SUPABASE_PROJECT_URL is required")
  return settings.supabase_project_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"


async def _fetch_jwks() -> dict[str, Any]:
  try:
    async with httpx.AsyncClient(timeout=10) as client:
      resp = await client.get(_jwks_url())
  except Exception as e:
    raise AppError("UNAUTHORIZED", "JWKS fetch failed", {"error": str(e)}, http_status=401)

  if resp.status_code != 200:
    raise AppError(
      "UNAUTHORIZED",
      "JWKS fetch failed",
      {"status_code": resp.status_code, "body": resp.text[:300]},
      http_status=401,
    )

  payload = resp.json()
  keys = payload.get("keys")
  if not isinstance(keys, list):
    raise AppError("UNAUTHORIZED", "JWKS is invalid", {"reason": "missing keys"}, http_status=401)

  parsed: dict[str, Any] = {}
  for jwk in keys:
    if isinstance(jwk, dict):
      kid = jwk.get("kid")
      if isinstance(kid, str) and kid:
        parsed[kid] = jwk
  if not parsed:
    raise AppError("UNAUTHORIZED", "JWKS is invalid", {"reason": "no usable keys"}, http_status=401)
  return parsed


async def _get_jwk_for_kid(kid: str) -> dict[str, Any]:
  global _jwks_cache
  now = time.monotonic()
  expires_at, keys = _jwks_cache
  if now >= expires_at or kid not in keys:
    keys = await _fetch_jwks()
    ttl = max(60, int(settings.supabase_jwks_cache_ttl_seconds))
    _jwks_cache = (time.monotonic() + ttl, keys)
  jwk = keys.get(kid)
  if not isinstance(jwk, dict):
    raise AppError("UNAUTHORIZED", "Signing key not found", {"kid": kid}, http_status=401)
  return jwk


async def verify_supabase_jwt(token: str) -> dict[str, Any]:
  try:
    header = jwt.get_unverified_header(token)
  except Exception as e:
    raise AppError("UNAUTHORIZED", "Invalid token header", {"error": str(e)}, http_status=401)

  alg = header.get("alg")
  if not isinstance(alg, str):
    raise AppError("UNAUTHORIZED", "Invalid token algorithm", http_status=401)
  alg_normalized = alg.strip().upper()
  if alg_normalized not in _SUPPORTED_JWT_ALGS:
    raise AppError("UNAUTHORIZED", "Unsupported token algorithm", {"alg": alg}, http_status=401)

  audience = settings.supabase_jwt_audiences_list
  if not audience:
    audience = ["authenticated"]
  issuer = _expected_jwt_issuer()

  try:
    if alg_normalized == "HS256":
      if not settings.supabase_secret_key:
        raise AppError("CONFIG_ERROR", "SUPABASE_SECRET_KEY is required for HS256 tokens")
      claims = jwt.decode(
        token,
        key=settings.supabase_secret_key,
        algorithms=["HS256"],
        audience=audience,
        issuer=issuer,
      )
    else:
      kid = header.get("kid")
      if not isinstance(kid, str) or not kid:
        raise AppError("UNAUTHORIZED", "Token is missing key id", http_status=401)
      jwk = await _get_jwk_for_kid(kid)
      if isinstance(jwk, str):
        jwk = json.loads(jwk)
      if not isinstance(jwk, dict):
        raise AppError("UNAUTHORIZED", "Signing key format is invalid", {"kid": kid}, http_status=401)
      key = PyJWK.from_dict(jwk).key
      claims = jwt.decode(
        token,
        key=key,
        algorithms=[alg_normalized],
        audience=audience,
        issuer=issuer,
      )
  except AppError:
    raise
  except InvalidTokenError as e:
    raise AppError("UNAUTHORIZED", "Invalid token", {"error": str(e)}, http_status=401)
  except Exception as e:
    raise AppError("UNAUTHORIZED", "Token verification failed", {"error": str(e)}, http_status=401)

  sub = claims.get("sub")
  if not isinstance(sub, str) or not sub:
    raise AppError("UNAUTHORIZED", "Invalid token payload", {"reason": "missing user id"}, http_status=401)
  return _normalized_jwt_claims(claims)


async def verify_access_token(token: str) -> dict[str, Any]:
  cached = _token_cache_get(token)
  if cached is not None:
    return cached

  mode = settings.auth_mode.strip().lower()
  if mode == "remote_userinfo":
    claims = await verify_supabase_userinfo(token)
  else:
    claims = await verify_supabase_jwt(token)

  _token_cache_set(token, claims)
  return claims


def _is_public_path(path: str) -> bool:
  return path.startswith("/api/health")


async def attach_auth_claims(request: Request, call_next):
  path = request.url.path
  if request.method == "OPTIONS" or not path.startswith("/api/") or _is_public_path(path):
    return await call_next(request)

  token = _extract_bearer_token(request.headers.get("Authorization"))
  if token is None:
    return error_response("UNAUTHORIZED", "Missing bearer token", status=401)

  try:
    claims = await verify_access_token(token)
  except AppError as exc:
    logger.warning(
      "auth_rejected",
      extra={
        "path": path,
        "code": exc.code,
        "message": exc.message,
        "details": exc.details or {},
      },
    )
    return error_response(exc.code, exc.message, exc.details, status=exc.http_status)

  request.state.auth_claims = ("supabase", claims)
  return await call_next(request)


async def get_auth_claims(request: Request) -> tuple[str, dict[str, Any]]:
  claims = getattr(request.state, "auth_claims", None)
  if isinstance(claims, tuple) and len(claims) == 2:
    provider, payload = claims
    if isinstance(provider, str) and isinstance(payload, dict):
      return provider, payload

  authorization = request.headers.get("Authorization")
  token = _extract_bearer_token(authorization)
  if token is None:
    raise AppError("UNAUTHORIZED", "Missing bearer token", http_status=401)
  claims = await verify_access_token(token)
  return "supabase", claims
