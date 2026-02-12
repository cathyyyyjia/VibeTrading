from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Request
from fastapi.responses import ORJSONResponse

ErrorCode = Literal["VALIDATION_ERROR", "DATA_UNAVAILABLE", "EXECUTION_GUARD_BLOCKED", "INTERNAL", "UNAUTHORIZED", "CONFIG_ERROR"]


@dataclass
class AppError(Exception):
  code: ErrorCode
  message: str
  details: dict[str, Any] | None = None
  http_status: int = 400


def error_response(code: ErrorCode, message: str, details: dict[str, Any] | None = None, status: int = 400) -> ORJSONResponse:
  payload: dict[str, Any] = {"code": code, "message": message}
  if details is not None:
    payload["details"] = details
  return ORJSONResponse(payload, status_code=status)


async def app_error_handler(_: Request, exc: AppError) -> ORJSONResponse:
  return error_response(exc.code, exc.message, exc.details, status=exc.http_status)


async def unhandled_error_handler(_: Request, exc: Exception) -> ORJSONResponse:
  return error_response("INTERNAL", "Unhandled error", {"error": str(exc)}, status=500)
