from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.models import User


def _now() -> datetime:
  return datetime.now(timezone.utc)


def _coerce_uuid(subject: str) -> uuid.UUID | None:
  try:
    return uuid.UUID(subject)
  except Exception:
    return None


async def ensure_user_from_claims(
  db: AsyncSession,
  provider: str,
  payload: dict[str, Any],
  *,
  touch_last_signed_in: bool = False,
  sync_profile: bool = False,
) -> User:
  _ = provider
  subject = payload.get("sub")
  subject_text = str(subject) if subject is not None else ""
  subject_uuid = _coerce_uuid(subject_text)
  if subject_uuid is None:
    raise AppError("UNAUTHORIZED", "invalid subject in token", {"sub": subject_text}, http_status=401)

  email = payload.get("email") if isinstance(payload.get("email"), str) else None
  name = None
  user_metadata = payload.get("user_metadata")
  if isinstance(user_metadata, dict):
    nm = user_metadata.get("display_name")
    if not isinstance(nm, str) or not nm.strip():
      nm = user_metadata.get("name")
    if isinstance(nm, str):
      name = nm
  if name is None and isinstance(payload.get("name"), str):
    name = payload.get("name")
  user = (await db.execute(select(User).where(User.id == subject_uuid))).scalar_one_or_none()
  if user is None:
    user = User(id=subject_uuid, email=email, name=name, last_signed_in_at=_now())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user

  changed = False
  now = _now()

  if sync_profile:
    if email is not None and user.email != email:
      user.email = email
      changed = True
    if name is not None and user.name != name:
      user.name = name
      changed = True

  if touch_last_signed_in:
    # Throttle last_seen updates to avoid write amplification on polling endpoints.
    last_seen = user.last_signed_in_at
    if last_seen is None or (now - last_seen).total_seconds() >= 300:
      user.last_signed_in_at = now
      changed = True

  if changed:
    await db.commit()
    await db.refresh(user)
  return user


async def update_user_profile(
  db: AsyncSession,
  *,
  user: User,
  name: str | None,
) -> User:
  changed = False
  clean_name = name.strip() if isinstance(name, str) else None
  if clean_name == "":
    clean_name = None
  if user.name != clean_name:
    user.name = clean_name
    changed = True
  if changed:
    await db.commit()
    await db.refresh(user)
  return user
