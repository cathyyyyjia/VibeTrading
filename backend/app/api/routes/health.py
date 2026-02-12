from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text
import redis.asyncio as redis

from app.core.config import settings
from app.db.engine import SessionLocal


router = APIRouter()


@router.get("")
async def health() -> dict[str, str]:
  return {"status": "ok"}


@router.get("/deps")
async def health_deps() -> dict[str, object]:
  db_status = "ok"
  redis_status = "disabled"
  try:
    async with SessionLocal() as db:
      await db.execute(text("select 1"))
  except Exception as e:
    db_status = f"error: {e}"

  if settings.redis_url:
    try:
      client = redis.from_url(settings.redis_url, decode_responses=True)
      await client.ping()
      await client.aclose()
      redis_status = "ok"
    except Exception as e:
      redis_status = f"error: {e}"

  return {
    "status": "ok" if db_status == "ok" else "degraded",
    "database": db_status,
    "redis": redis_status,
    "market_data_provider": settings.market_data_provider,
  }
