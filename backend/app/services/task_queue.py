from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from redis import Redis
from rq import Queue, Retry
from sqlalchemy import select

from app.core.config import settings
from app.db.engine import SessionLocal
from app.db.models import Run, RunArtifact

logger = logging.getLogger(__name__)


def _dedupe_key(run_id: uuid.UUID) -> str:
  return f"vibe:run:queued:{run_id}"


def _redis_sync() -> Redis:
  return Redis.from_url(settings.redis_url, decode_responses=True)


def enqueue_run_job(run_id: uuid.UUID, start_date: str, end_date: str) -> str | None:
  if not settings.task_queue_enabled:
    return None

  redis_conn = _redis_sync()
  dedupe_key = _dedupe_key(run_id)
  lock_ttl = max(300, int(settings.task_queue_job_timeout_seconds) * 2)
  locked = redis_conn.set(dedupe_key, "1", nx=True, ex=lock_ttl)
  if not locked:
    logger.info("run_enqueue_skipped_already_queued", extra={"run_id": str(run_id)})
    return None

  try:
    queue = Queue(
      settings.task_queue_name,
      connection=redis_conn,
      default_timeout=int(settings.task_queue_job_timeout_seconds),
    )
    retry = Retry(max=3, interval=[15, 60, 300])
    job = queue.enqueue(
      "app.services.worker_jobs.execute_run_job",
      str(run_id),
      start_date,
      end_date,
      retry=retry,
      job_timeout=int(settings.task_queue_job_timeout_seconds),
      result_ttl=86400,
      failure_ttl=86400,
    )
    return str(job.id)
  except Exception:
    redis_conn.delete(dedupe_key)
    raise


async def enqueue_run_job_async(run_id: uuid.UUID, start_date: str, end_date: str) -> str | None:
  return await asyncio.to_thread(enqueue_run_job, run_id, start_date, end_date)


async def recover_running_runs() -> int:
  if not settings.task_queue_enabled:
    return 0

  cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, int(settings.task_queue_recovery_lookback_hours)))
  recovered = 0
  async with SessionLocal() as db:
    rows = (
      await db.execute(
        select(Run).where(
          Run.state == "running",
          Run.created_at >= cutoff,
        )
      )
    ).scalars().all()

    for run in rows:
      try:
        started = "2025-01-01"
        ended = "2025-12-31"
        req_art = (
          await db.execute(
            select(RunArtifact).where(
              RunArtifact.run_id == run.id,
              RunArtifact.name == "request.json",
            )
          )
        ).scalar_one_or_none()
        if req_art and isinstance(req_art.content, dict):
          s = req_art.content.get("start_date")
          e = req_art.content.get("end_date")
          if isinstance(s, str) and s:
            started = s
          if isinstance(e, str) and e:
            ended = e
        enqueued = await enqueue_run_job_async(run.id, started, ended)
        if enqueued is not None:
          recovered += 1
      except Exception:
        logger.exception("run_recovery_enqueue_failed", extra={"run_id": str(run.id)})
  return recovered
