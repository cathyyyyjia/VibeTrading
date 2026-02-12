from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.engine import get_db
from app.db.models import OAuthIdentity
from app.core.auth import get_auth_claims
from app.services.user_service import ensure_user_from_claims


router = APIRouter()


class IdentityResponse(BaseModel):
  provider: str
  subject: str
  email: str | None
  profile: dict[str, Any] | None


class UserResponse(BaseModel):
  user_id: str
  email: str | None
  name: str | None
  created_at: str
  last_signed_in_at: str | None
  identities: list[IdentityResponse]


@router.get("", response_model=list[UserResponse])
async def list_users(db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> list[UserResponse]:
  provider, payload = claims
  u = await ensure_user_from_claims(db, provider, payload)
  identities = (await db.execute(select(OAuthIdentity).where(OAuthIdentity.user_id == u.id))).scalars().all()
  return [
    UserResponse(
      user_id=str(u.id),
      email=u.email,
      name=u.name,
      created_at=u.created_at.isoformat(),
      last_signed_in_at=u.last_signed_in_at.isoformat() if u.last_signed_in_at else None,
      identities=[IdentityResponse(provider=i.provider, subject=i.subject, email=i.email, profile=i.profile) for i in identities],
    )
  ]


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> UserResponse:
  provider, payload = claims
  cu = await ensure_user_from_claims(db, provider, payload)
  if cu.id != user_id:
    raise AppError("UNAUTHORIZED", "forbidden", {"user_id": str(user_id)}, http_status=403)
  u = cu
  identities = (await db.execute(select(OAuthIdentity).where(OAuthIdentity.user_id == u.id))).scalars().all()
  return UserResponse(
    user_id=str(u.id),
    email=u.email,
    name=u.name,
    created_at=u.created_at.isoformat(),
    last_signed_in_at=u.last_signed_in_at.isoformat() if u.last_signed_in_at else None,
    identities=[IdentityResponse(provider=i.provider, subject=i.subject, email=i.email, profile=i.profile) for i in identities],
  )
