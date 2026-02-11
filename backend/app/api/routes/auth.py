from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_auth_claims
from app.core.config import settings
from app.core.errors import AppError
from app.db.engine import get_db
from app.services.user_service import upsert_oauth_identity


router = APIRouter()


class OAuthUpsertRequest(BaseModel):
  provider: str = Field(default="oauth")
  subject: str
  email: str | None = None
  name: str | None = None
  profile: dict[str, Any] | None = None


class MeResponse(BaseModel):
  user_id: str
  email: str | None
  name: str | None
  provider: str
  subject: str


@router.get("/me", response_model=MeResponse)
async def me(
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
) -> MeResponse:
  provider, payload = claims
  subject = payload.get("sub")
  if not isinstance(subject, str) or not subject:
    raise AppError("UNAUTHORIZED", "Token missing subject")

  email = payload.get("email") if isinstance(payload.get("email"), str) else None
  name = None
  user_metadata = payload.get("user_metadata")
  if isinstance(user_metadata, dict):
    nm = user_metadata.get("name")
    if isinstance(nm, str):
      name = nm
  if name is None and isinstance(payload.get("name"), str):
    name = payload.get("name")

  user = await upsert_oauth_identity(db, provider=provider, subject=subject, email=email, name=name, profile=payload)
  return MeResponse(user_id=str(user.id), email=user.email, name=user.name, provider=provider, subject=subject)


@router.post("/oauth/upsert", response_model=MeResponse)
async def oauth_upsert(
  req: OAuthUpsertRequest,
  db: AsyncSession = Depends(get_db),
  x_oauth_ingest_secret: str | None = Header(default=None),
):
  if settings.oauth_ingest_secret:
    if x_oauth_ingest_secret != settings.oauth_ingest_secret:
      raise AppError("UNAUTHORIZED", "Invalid ingest secret")
  elif settings.app_env != "local":
    raise AppError("CONFIG_ERROR", "OAUTH_INGEST_SECRET is required outside local")

  user = await upsert_oauth_identity(
    db,
    provider=req.provider,
    subject=req.subject,
    email=req.email,
    name=req.name,
    profile=req.profile,
  )
  return MeResponse(user_id=str(user.id), email=user.email, name=user.name, provider=req.provider, subject=req.subject)
