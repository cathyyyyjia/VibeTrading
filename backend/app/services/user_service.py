from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import OAuthIdentity, User


def _now() -> datetime:
  return datetime.now(timezone.utc)

async def ensure_user_from_claims(
  db: AsyncSession,
  provider: str,
  payload: dict[str, Any],
) -> User:
  subject = payload.get("sub")
  email = payload.get("email") if isinstance(payload.get("email"), str) else None
  name = None
  user_metadata = payload.get("user_metadata")
  if isinstance(user_metadata, dict):
    nm = user_metadata.get("name")
    if isinstance(nm, str):
      name = nm
  if name is None and isinstance(payload.get("name"), str):
    name = payload.get("name")
  return await upsert_oauth_identity(db, provider=provider, subject=str(subject), email=email, name=name, profile=payload)

async def upsert_oauth_identity(
  db: AsyncSession,
  *,
  provider: str,
  subject: str,
  email: str | None,
  name: str | None,
  profile: dict[str, Any] | None,
) -> User:
  identity = (
    await db.execute(select(OAuthIdentity).where(OAuthIdentity.provider == provider, OAuthIdentity.subject == subject))
  ).scalar_one_or_none()

  if identity is None:
    user = User(email=email, name=name, last_signed_in_at=_now())
    db.add(user)
    await db.flush()
    identity = OAuthIdentity(
      user_id=user.id,
      provider=provider,
      subject=subject,
      email=email,
      profile=profile,
    )
    db.add(identity)
    await db.commit()
    await db.refresh(user)
    return user

  user = (await db.execute(select(User).where(User.id == identity.user_id))).scalar_one()
  identity.email = email
  identity.profile = profile
  user.last_signed_in_at = _now()
  if email is not None:
    user.email = email
  if name is not None:
    user.name = name
  await db.commit()
  await db.refresh(user)
  return user


async def get_user_with_identities(db: AsyncSession, user_id: uuid.UUID) -> tuple[User, list[OAuthIdentity]]:
  user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
  identities = (await db.execute(select(OAuthIdentity).where(OAuthIdentity.user_id == user_id))).scalars().all()
  return user, list(identities)
