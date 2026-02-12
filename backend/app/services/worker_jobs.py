from __future__ import annotations

import asyncio
import uuid

from app.services.run_service import execute_run


def execute_run_job(run_id: str, start_date: str, end_date: str) -> None:
  asyncio.run(execute_run(uuid.UUID(run_id), start_date=start_date, end_date=end_date))

