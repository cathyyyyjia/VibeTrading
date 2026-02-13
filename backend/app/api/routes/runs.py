from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from fastapi import Query
from pydantic import BaseModel
from fastapi.responses import ORJSONResponse
from fastapi.responses import PlainTextResponse
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, error_response
from app.core.config import settings
from app.core.auth import get_auth_claims
from app.db.engine import get_db
from app.db.models import Run, RunArtifact, RunStep, Strategy, Trade
from app.schemas.contracts import (
  BacktestKpis,
  BacktestReportResponse,
  CreateRunResponse,
  NaturalLanguageStrategyRequest,
  RunHistoryEntry,
  RunHistoryResponse,
  RunStatusResponse,
  WorkspaceStep,
)
from app.services.run_service import create_run, execute_run
from app.services.storage_service import create_signed_url, download_bytes, download_json, parse_storage_uri
from app.services.task_queue import enqueue_run_job_async
from app.services.user_service import ensure_user_from_claims


router = APIRouter()


async def _load_artifact_json(art: RunArtifact) -> dict[str, Any] | None:
  if isinstance(art.content, dict):
    return art.content
  if parse_storage_uri(art.uri) is None:
    return None
  return await download_json(art.uri)


async def _load_artifact_bytes(art: RunArtifact) -> bytes | None:
  if parse_storage_uri(art.uri) is None:
    return None
  return await download_bytes(art.uri)


@router.post("", response_model=CreateRunResponse)
async def post_run(
  req: NaturalLanguageStrategyRequest,
  background_tasks: BackgroundTasks,
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
) -> CreateRunResponse:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload)
  run = await create_run(db, req, user_id=user.id)

  if settings.task_queue_enabled:
    enqueued = await enqueue_run_job_async(run.id, req.start_date.isoformat(), req.end_date.isoformat())
    if enqueued is None:
      # De-duplicated by queue lock; still return accepted for idempotent client behavior.
      pass
  else:
    background_tasks.add_task(execute_run, run.id, req.start_date.isoformat(), req.end_date.isoformat())

  return CreateRunResponse(
    run_id=str(run.id),
    message=f"Backtest run created. Track status via Realtime updates or GET /api/runs/{run.id}/status.",
  )


def _coerce_logs(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
  out: list[dict[str, Any]] = []
  for r in raw:
    rr = dict(r)
    ts = rr.get("ts")
    if isinstance(ts, str):
      try:
        rr["ts"] = datetime.fromisoformat(ts.replace("Z", "+00:00"))
      except Exception:
        pass
    out.append(rr)
  return out


async def _get_user_owned_run(
  db: AsyncSession,
  run_id: uuid.UUID,
  claims: tuple[str, dict[str, Any]],
) -> Run:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload)
  run = (await db.execute(select(Run).where(Run.id == run_id, Run.user_id == user.id))).scalar_one_or_none()
  if run is None:
    raise AppError("DATA_UNAVAILABLE", "run not found", {"run_id": str(run_id)}, http_status=404)
  return run


@router.get("/{run_id}/status", response_model=RunStatusResponse)
async def get_status(run_id: uuid.UUID, db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> RunStatusResponse:
  run = await _get_user_owned_run(db, run_id, claims)

  steps = (await db.execute(select(RunStep).where(RunStep.run_id == run_id))).scalars().all()
  artifacts = (await db.execute(select(RunArtifact).where(RunArtifact.run_id == run_id).order_by(RunArtifact.created_at.asc()))).scalars().all()

  step_order = {"parse": 0, "plan": 1, "data": 2, "backtest": 3, "report": 4, "deploy": 5}
  steps.sort(key=lambda s: step_order.get(s.step_id, 999))

  ws_steps: list[WorkspaceStep] = []
  for s in steps:
    ws_steps.append(
      WorkspaceStep(id=s.step_id, state=s.state, label=s.label, logs=_coerce_logs(s.logs))  # type: ignore[arg-type]
    )

  art_refs = [{"id": str(a.id), "type": a.type, "name": a.name, "uri": a.uri} for a in artifacts]
  return RunStatusResponse(run_id=str(run.id), state=run.state, steps=ws_steps, artifacts=art_refs)  # type: ignore[arg-type]


@router.get("/{run_id}/report", response_model=None)
async def get_report(
  run_id: uuid.UUID,
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
  format: str | None = Query(default=None),
) -> Response:
  await _get_user_owned_run(db, run_id, claims)
  art = (
    await db.execute(select(RunArtifact).where(RunArtifact.run_id == run_id, RunArtifact.name == "report.json"))
  ).scalar_one_or_none()
  if art is None:
    raise AppError("DATA_UNAVAILABLE", "report not ready", {"run_id": str(run_id)}, http_status=404)

  report_content = await _load_artifact_json(art)
  if report_content is None:
    raise AppError("DATA_UNAVAILABLE", "report not ready", {"run_id": str(run_id)}, http_status=404)

  if format == "csv":
    trades = report_content.get("trades") if isinstance(report_content, dict) else None
    if not isinstance(trades, list):
      return PlainTextResponse("", media_type="text/csv")
    rows = ["decision_time,fill_time,symbol,side,qty,fill_price"]
    for t in trades:
      if isinstance(t, dict):
        rows.append(f"{t.get('decision_time','')},{t.get('fill_time','')},{t.get('symbol','')},{t.get('side','')},{t.get('qty','')},{t.get('fill_price','')}")
    return PlainTextResponse("\n".join(rows), media_type="text/csv")
  return BacktestReportResponse.model_validate(report_content)


@router.get("/history", response_model=RunHistoryResponse)
async def get_history(db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> RunHistoryResponse:
  provider, payload = claims
  user = await ensure_user_from_claims(db, provider, payload)
  runs = (
    await db.execute(select(Run).where(Run.user_id == user.id, Run.state.in_(["completed", "failed"])).order_by(Run.updated_at.desc()).limit(100))
  ).scalars().all()

  if not runs:
    return RunHistoryResponse(history=[])

  strategy_ids = {r.strategy_id for r in runs}
  run_ids = {r.id for r in runs}
  strategies = (
    await db.execute(select(Strategy).where(Strategy.id.in_(strategy_ids)))
  ).scalars().all()
  strategy_by_id = {s.id: s for s in strategies}

  artifact_rows = (
    await db.execute(
      select(RunArtifact.run_id, RunArtifact.name, RunArtifact.uri).where(RunArtifact.run_id.in_(run_ids))
    )
  ).all()
  artifacts_by_run_id: dict[uuid.UUID, dict[str, str]] = {}
  for run_id_value, name, uri in artifact_rows:
    artifacts_by_run_id.setdefault(run_id_value, {})[name] = uri

  kpis_rows = (
    await db.execute(
      select(RunArtifact.run_id, RunArtifact.name, RunArtifact.content, RunArtifact.uri).where(
        RunArtifact.run_id.in_(run_ids),
        RunArtifact.name.in_(["kpis.json", "report.json"]),
      )
    )
  ).all()
  kpis_by_run_id: dict[uuid.UUID, BacktestKpis | None] = {}
  for run_id_value, name, content, uri in kpis_rows:
    if run_id_value in kpis_by_run_id and kpis_by_run_id[run_id_value] is not None:
      continue

    resolved_content: dict[str, Any] | None = content if isinstance(content, dict) else None
    if resolved_content is None and isinstance(uri, str) and parse_storage_uri(uri) is not None:
      resolved_content = await download_json(uri)
    if not isinstance(resolved_content, dict):
      continue

    try:
      if name == "kpis.json":
        raw = resolved_content.get("kpis")
      else:
        raw = resolved_content.get("kpis")
      if isinstance(raw, dict):
        kpis_by_run_id[run_id_value] = BacktestKpis.model_validate(raw)
    except Exception:
      if run_id_value not in kpis_by_run_id:
        kpis_by_run_id[run_id_value] = None

  out: list[RunHistoryEntry] = []
  for r in runs:
    strategy = strategy_by_id.get(r.strategy_id)
    artifact_map = artifacts_by_run_id.get(r.id, {})
    kpis = kpis_by_run_id.get(r.id)

    out.append(
      RunHistoryEntry(
        run_id=str(r.id),
        strategy_id=str(r.strategy_id),
        prompt=strategy.prompt if strategy else None,
        state="completed" if r.state == "completed" else "failed",
        completed_at=r.updated_at,
        kpis=kpis,
        artifacts=artifact_map,
      )
    )

  return RunHistoryResponse(history=out)


@router.get("/{run_id}/artifacts/{name}", response_model=None)
async def get_artifact(
  run_id: uuid.UUID,
  name: str,
  db: AsyncSession = Depends(get_db),
  claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims),
  download: bool = Query(default=False),
) -> Response:
  await _get_user_owned_run(db, run_id, claims)
  art = (await db.execute(select(RunArtifact).where(RunArtifact.run_id == run_id, RunArtifact.name == name))).scalar_one_or_none()
  if art is None:
    return error_response("DATA_UNAVAILABLE", "artifact not found", {"run_id": str(run_id), "name": name}, status=404)

  if download and parse_storage_uri(art.uri) is not None:
    signed = await create_signed_url(art.uri, download_name=art.name)
    if not signed:
      return error_response("DATA_UNAVAILABLE", "artifact signed url unavailable", {"run_id": str(run_id), "name": name}, status=404)
    return RedirectResponse(signed, status_code=307)

  if art.type == "csv" and isinstance(art.content, dict) and isinstance(art.content.get("csv"), str):
    return PlainTextResponse(art.content["csv"], media_type="text/csv")
  if art.type == "markdown" and isinstance(art.content, dict) and isinstance(art.content.get("markdown"), str):
    return PlainTextResponse(art.content["markdown"], media_type="text/markdown")

  if parse_storage_uri(art.uri) is not None and art.content is None:
    if art.type in ("csv", "markdown"):
      payload = await _load_artifact_bytes(art)
      if payload is None:
        return error_response("DATA_UNAVAILABLE", "artifact not available", {"run_id": str(run_id), "name": name}, status=404)
      media_type = "text/csv" if art.type == "csv" else "text/markdown"
      return PlainTextResponse(payload.decode("utf-8"), media_type=media_type)

    json_payload = await _load_artifact_json(art)
    if json_payload is None:
      return ORJSONResponse({"name": art.name, "type": art.type, "uri": art.uri, "content": None})
    return ORJSONResponse({"name": art.name, "type": art.type, "uri": art.uri, "content": json_payload})

  return ORJSONResponse({"name": art.name, "type": art.type, "uri": art.uri, "content": art.content})


class DeployRequest(BaseModel):
  mode: str


@router.post("/{run_id}/deploy")
async def deploy(run_id: uuid.UUID, _: DeployRequest, db: AsyncSession = Depends(get_db), claims: tuple[str, dict[str, Any]] = Depends(get_auth_claims)) -> dict[str, str]:
  await _get_user_owned_run(db, run_id, claims)
  return {"deployId": str(run_id), "status": "queued"}
