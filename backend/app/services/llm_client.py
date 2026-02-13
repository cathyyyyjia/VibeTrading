from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import AppError


class LlmClient:
  def __init__(self) -> None:
    self._base_url = str(settings.llm_base_url).rstrip("/")
    self._api_key = settings.llm_api_key
    self._model = settings.llm_model

  @property
  def is_configured(self) -> bool:
    return bool(self._api_key)

  async def chat_json(
    self,
    system_prompt: str,
    user_prompt: str,
    *,
    schema_name: str | None = None,
    json_schema: dict[str, Any] | None = None,
    strict_schema: bool = True,
  ) -> dict[str, Any]:
    if not self._api_key:
      raise AppError("VALIDATION_ERROR", "LLM is not configured", {"missing": ["LLM_API_KEY"]}, http_status=400)

    url = f"{self._base_url}/chat/completions"
    headers = {"authorization": f"Bearer {self._api_key}", "content-type": "application/json"}
    response_format: dict[str, Any]
    if json_schema is not None:
      response_format = {
        "type": "json_schema",
        "json_schema": {
          "name": schema_name or "response_schema",
          "strict": strict_schema,
          "schema": json_schema,
        },
      }
    else:
      response_format = {"type": "json_object"}

    payload = {
      "model": self._model,
      "response_format": response_format,
      "messages": [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
      ],
    }

    timeout = httpx.Timeout(float(settings.llm_request_timeout_seconds), connect=10.0)
    max_retries = max(0, int(settings.llm_max_retries))
    retryable_status = {408, 429, 500, 502, 503, 504}

    data: dict[str, Any] | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
      for attempt in range(max_retries + 1):
        try:
          resp = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
          if attempt < max_retries:
            await asyncio.sleep(float(settings.llm_retry_backoff_seconds) * (attempt + 1))
            continue
          raise AppError(
            "INTERNAL",
            "LLM request timed out",
            {"attempts": attempt + 1, "timeout_seconds": settings.llm_request_timeout_seconds, "error": str(exc)},
            http_status=504,
          )
        except httpx.HTTPError as exc:
          if attempt < max_retries:
            await asyncio.sleep(float(settings.llm_retry_backoff_seconds) * (attempt + 1))
            continue
          raise AppError(
            "INTERNAL",
            "LLM transport failed",
            {"attempts": attempt + 1, "error": str(exc)},
            http_status=502,
          )

        if resp.status_code >= 400:
          if resp.status_code in retryable_status and attempt < max_retries:
            await asyncio.sleep(float(settings.llm_retry_backoff_seconds) * (attempt + 1))
            continue
          raise AppError(
            "INTERNAL",
            "LLM request failed",
            {"status": resp.status_code, "body": resp.text[:2000], "attempts": attempt + 1},
            http_status=502,
          )
        data = resp.json()
        break

    if data is None:
      raise AppError("INTERNAL", "LLM request failed without response payload", {}, http_status=502)

    try:
      content = data["choices"][0]["message"]["content"]
      if isinstance(content, dict):
        return content
      return json.loads(content)
    except Exception as e:
      raise AppError("VALIDATION_ERROR", "INVALID_LLM_OUTPUT", {"error": str(e), "raw": str(data)[:2000]}, http_status=400)


llm_client = LlmClient()
