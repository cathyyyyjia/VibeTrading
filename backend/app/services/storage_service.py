from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any
from urllib.parse import quote

import httpx

from app.core.config import settings


def storage_enabled() -> bool:
  return bool(
    settings.supabase_storage_enabled
    and settings.supabase_project_url
    and settings.supabase_secret_key
    and settings.supabase_storage_bucket
  )


_client: Any | None = None


def _get_client() -> Any:
  global _client
  if _client is None:
    from supabase import create_client

    if not settings.supabase_project_url or not settings.supabase_secret_key:
      raise RuntimeError("Supabase storage is not configured")
    _client = create_client(settings.supabase_project_url, settings.supabase_secret_key)
  return _client


def storage_uri(bucket: str, path: str) -> str:
  return f"sb://{bucket}/{path}"


def parse_storage_uri(uri: str) -> tuple[str, str] | None:
  if not uri.startswith("sb://"):
    return None
  payload = uri[len("sb://") :]
  first = payload.find("/")
  if first <= 0:
    return None
  return payload[:first], payload[first + 1 :]


def _object_path(run_id: uuid.UUID, name: str) -> str:
  safe_name = quote(name, safe="._-")
  return f"runs/{run_id}/{safe_name}"


def _serialize_content(type_: str, content: Any) -> tuple[bytes, str]:
  if type_ == "json":
    return json.dumps(content, ensure_ascii=False).encode("utf-8"), "application/json"
  if type_ == "csv":
    csv_text = ""
    if isinstance(content, dict):
      raw = content.get("csv")
      if isinstance(raw, str):
        csv_text = raw
    elif isinstance(content, str):
      csv_text = content
    return csv_text.encode("utf-8"), "text/csv; charset=utf-8"
  if type_ == "markdown":
    md_text = ""
    if isinstance(content, dict):
      raw = content.get("markdown")
      if isinstance(raw, str):
        md_text = raw
    elif isinstance(content, str):
      md_text = content
    return md_text.encode("utf-8"), "text/markdown; charset=utf-8"
  return json.dumps(content, ensure_ascii=False).encode("utf-8"), "application/octet-stream"


def _upload_bytes(bucket: str, path: str, payload: bytes, content_type: str) -> None:
  client = _get_client()
  client.storage.from_(bucket).upload(
    path,
    payload,
    file_options={"content-type": content_type, "upsert": "true"},
  )


async def upload_artifact_content(
  *,
  run_id: uuid.UUID,
  name: str,
  type_: str,
  content: Any,
) -> str | None:
  if not storage_enabled() or content is None:
    return None
  bucket = settings.supabase_storage_bucket
  path = _object_path(run_id, name)
  payload, content_type = _serialize_content(type_, content)
  await asyncio.to_thread(_upload_bytes, bucket, path, payload, content_type)
  return storage_uri(bucket, path)


def _signed_url(bucket: str, path: str, expires_in: int, download_name: str | None) -> str | None:
  client = _get_client()
  options: dict[str, Any] = {}
  if download_name:
    options["download"] = download_name
  data = client.storage.from_(bucket).create_signed_url(path, expires_in, options)
  if not isinstance(data, dict):
    return None
  signed = data.get("signedURL") or data.get("signedUrl") or data.get("signed_url")
  if not isinstance(signed, str) or not signed:
    return None
  if signed.startswith("http://") or signed.startswith("https://"):
    return signed
  base = (settings.supabase_project_url or "").rstrip("/")
  return f"{base}{signed}"


async def create_signed_url(uri: str, *, download_name: str | None = None) -> str | None:
  parsed = parse_storage_uri(uri)
  if parsed is None:
    return None
  bucket, path = parsed
  expires = max(60, int(settings.supabase_storage_signed_url_ttl_seconds))
  return await asyncio.to_thread(_signed_url, bucket, path, expires, download_name)


async def download_bytes(uri: str) -> bytes | None:
  signed = await create_signed_url(uri)
  if not signed:
    return None
  async with httpx.AsyncClient(timeout=30.0) as client:
    res = await client.get(signed)
    if res.status_code >= 400:
      return None
    return res.content


async def download_json(uri: str) -> dict[str, Any] | None:
  payload = await download_bytes(uri)
  if payload is None:
    return None
  try:
    data = json.loads(payload.decode("utf-8"))
    if isinstance(data, dict):
      return data
    return None
  except Exception:
    return None
