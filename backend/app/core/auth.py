from __future__ import annotations

from typing import Any

import httpx
from fastapi import Header

from app.core.config import settings
from app.core.errors import AppError


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
  return claims


async def get_auth_claims(authorization: str | None = Header(default=None)) -> tuple[str, dict[str, Any]]:
  token = _extract_bearer_token(authorization)
  if token is None:
    raise AppError("UNAUTHORIZED", "Missing bearer token", http_status=401)
  claims = await verify_supabase_userinfo(token)
  return "supabase", claims
