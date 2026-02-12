from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import Request

from app.core.config import settings
from app.core.errors import AppError, error_response

_TOKEN_CACHE_TTL_SECONDS = 60.0
_token_cache: dict[str, tuple[float, dict[str, Any]]] = {}


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
  now = time.monotonic()
  cached = _token_cache.get(token)
  if cached is not None:
    expires_at, claims = cached
    if expires_at > now:
      return claims
    _token_cache.pop(token, None)

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
  _token_cache[token] = (time.monotonic() + _TOKEN_CACHE_TTL_SECONDS, claims)
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
    claims = await verify_supabase_userinfo(token)
  except AppError as exc:
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
  claims = await verify_supabase_userinfo(token)
  return "supabase", claims
