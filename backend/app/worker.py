from __future__ import annotations

from redis import Redis
from rq import Connection, Worker

from app.core.config import settings


def main() -> None:
  redis_conn = Redis.from_url(settings.redis_url, decode_responses=True)
  with Connection(redis_conn):
    worker = Worker([settings.task_queue_name])
    worker.work(with_scheduler=True)


if __name__ == "__main__":
  main()

