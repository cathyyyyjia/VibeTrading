from __future__ import annotations

from collections.abc import AsyncIterator
import uuid
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings


def _normalize_async_database_url(url: str) -> str:
  if url.startswith("sqlite"):
    raise ValueError("SQLite is not supported. Configure DATABASE_URL to a Supabase/Postgres connection string.")
  if url.startswith("postgresql://"):
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)
  return url


_db_url = _normalize_async_database_url(settings.database_url)
_parsed = urlparse(_db_url)
_host = (_parsed.hostname or "").lower()
_port = _parsed.port or 0
_is_supabase_pooler = _host.endswith(".pooler.supabase.com") or _port in (6543, 6432)
_connect_args: dict[str, object] = {}
_engine_kwargs: dict[str, object] = {"pool_pre_ping": True, "connect_args": _connect_args}
if _is_supabase_pooler:
  # Supabase pooler uses PgBouncer transaction pooling; prepared statements
  # can break across transactions unless both caches are disabled.
  _connect_args["statement_cache_size"] = 0
  _connect_args["prepared_statement_cache_size"] = 0
  # Generate unique names for any unavoidable prepared statements.
  _connect_args["prepared_statement_name_func"] = lambda: f"__asyncpg_{uuid.uuid4()}__"
  # Avoid long-lived client-side pooled connections on top of PgBouncer.
  _engine_kwargs["poolclass"] = NullPool

engine: AsyncEngine = create_async_engine(_db_url, **_engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
  async with SessionLocal() as session:
    yield session
