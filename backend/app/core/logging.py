from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from pythonjsonlogger.jsonlogger import JsonFormatter


class UtcJsonFormatter(JsonFormatter):
  def add_fields(self, log_record: dict[str, Any], record: logging.LogRecord, message_dict: dict[str, Any]) -> None:
    super().add_fields(log_record, record, message_dict)
    if "timestamp" not in log_record:
      log_record["timestamp"] = datetime.now(timezone.utc).isoformat()
    if "level" not in log_record:
      log_record["level"] = record.levelname
    if "logger" not in log_record:
      log_record["logger"] = record.name


def configure_logging(level: str) -> None:
  root = logging.getLogger()
  root.setLevel(level.upper())

  handler = logging.StreamHandler()
  handler.setLevel(level.upper())
  handler.setFormatter(UtcJsonFormatter(json.dumps({"message": "%(message)s"})))

  root.handlers.clear()
  root.addHandler(handler)

