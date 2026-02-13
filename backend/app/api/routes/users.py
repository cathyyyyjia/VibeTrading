from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_auth_claims
from app.db.engine import get_db
from app.services.user_service import ensure_user_from_claims, update_user_profile


router = APIRouter()


class UserMeResponse(BaseModel):
  user_id: str
  email: str | None
  display_name: str | None
  created_at: str
  last_signed_in_at: str | None


class UpdateProfileRequest(BaseModel):
  display_name: str | None = Field(default=None, max_length=120)


def _to_user_me_response(user_id: str, email: str | None, display_name: str | None, created_at: str, last_signed_in_at: str | None) -> UserMeResponse:
  return UserMeResponse(
    user_id=user_id,
    email=email,
    display_name=display_name,
    created_at=created_at,
    last_signed_in_at=last_signed_in_at,
  )


@router.get("/me", response_model=UserMeResponse)
async def get_my_profile(
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
) -> UserMeResponse:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload, touch_last_signed_in=True, sync_profile=True)
  return _to_user_me_response(
    user_id=str(user.id),
    email=user.email,
    display_name=user.name,
    created_at=user.created_at.isoformat(),
    last_signed_in_at=user.last_signed_in_at.isoformat() if user.last_signed_in_at else None,
  )


@router.patch("/me", response_model=UserMeResponse)
async def update_my_profile(
  req: UpdateProfileRequest,
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
) -> UserMeResponse:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload, touch_last_signed_in=True, sync_profile=False)
  user = await update_user_profile(db, user=user, name=req.display_name)
  return _to_user_me_response(
    user_id=str(user.id),
    email=user.email,
    display_name=user.name,
    created_at=user.created_at.isoformat(),
    last_signed_in_at=user.last_signed_in_at.isoformat() if user.last_signed_in_at else None,
  )
