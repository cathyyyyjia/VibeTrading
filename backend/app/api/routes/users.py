from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_db
from app.db.models import OAuthIdentity, User


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
async def list_users(db: AsyncSession = Depends(get_db)) -> list[UserResponse]:
  users = (await db.execute(select(User).order_by(User.created_at.desc()).limit(200))).scalars().all()
  out: list[UserResponse] = []
  for u in users:
    identities = (await db.execute(select(OAuthIdentity).where(OAuthIdentity.user_id == u.id))).scalars().all()
    out.append(
      UserResponse(
        user_id=str(u.id),
        email=u.email,
        name=u.name,
        created_at=u.created_at.isoformat(),
        last_signed_in_at=u.last_signed_in_at.isoformat() if u.last_signed_in_at else None,
        identities=[
          IdentityResponse(provider=i.provider, subject=i.subject, email=i.email, profile=i.profile) for i in identities
        ],
      )
    )
  return out


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> UserResponse:
  u = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
  identities = (await db.execute(select(OAuthIdentity).where(OAuthIdentity.user_id == u.id))).scalars().all()
  return UserResponse(
    user_id=str(u.id),
    email=u.email,
    name=u.name,
    created_at=u.created_at.isoformat(),
    last_signed_in_at=u.last_signed_in_at.isoformat() if u.last_signed_in_at else None,
    identities=[IdentityResponse(provider=i.provider, subject=i.subject, email=i.email, profile=i.profile) for i in identities],
  )

