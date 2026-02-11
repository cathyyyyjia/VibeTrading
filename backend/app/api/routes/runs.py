from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from fastapi.responses import ORJSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, error_response
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


router = APIRouter()


@router.post("", response_model=CreateRunResponse)
async def post_run(
  req: NaturalLanguageStrategyRequest,
  background_tasks: BackgroundTasks,
  db: AsyncSession = Depends(get_db),
) -> CreateRunResponse:
  run = await create_run(db, req)
  background_tasks.add_task(execute_run, run.id)
  return CreateRunResponse(
    run_id=str(run.id),
    message=f"Backtest run created. Poll /api/runs/{run.id}/status for progress.",
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


@router.get("/{run_id}/status", response_model=RunStatusResponse)
async def get_status(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> RunStatusResponse:
  run = (await db.execute(select(Run).where(Run.id == run_id))).scalar_one_or_none()
  if run is None:
    raise AppError("DATA_UNAVAILABLE", "run not found", {"run_id": str(run_id)}, http_status=404)

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
  return RunStatusResponse(run_id=str(run.id), state=run.state, progress=run.progress, steps=ws_steps, artifacts=art_refs)  # type: ignore[arg-type]


@router.get("/{run_id}/report", response_model=BacktestReportResponse)
async def get_report(run_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> BacktestReportResponse:
  art = (
    await db.execute(select(RunArtifact).where(RunArtifact.run_id == run_id, RunArtifact.name == "report.json"))
  ).scalar_one_or_none()
  if art is None or art.content is None:
    raise AppError("DATA_UNAVAILABLE", "report not ready", {"run_id": str(run_id)}, http_status=404)
  return BacktestReportResponse.model_validate(art.content)


@router.get("/history", response_model=RunHistoryResponse)
async def get_history(db: AsyncSession = Depends(get_db)) -> RunHistoryResponse:
  runs = (
    await db.execute(select(Run).where(Run.state.in_(["completed", "failed"])).order_by(Run.updated_at.desc()).limit(100))
  ).scalars().all()

  out: list[RunHistoryEntry] = []
  for r in runs:
    strategy = (await db.execute(select(Strategy).where(Strategy.id == r.strategy_id))).scalar_one_or_none()
    artifacts = (await db.execute(select(RunArtifact).where(RunArtifact.run_id == r.id))).scalars().all()
    artifact_map = {a.name: a.uri for a in artifacts}

    kpis: BacktestKpis | None = None
    report = next((a for a in artifacts if a.name == "report.json" and a.content is not None), None)
    if report is not None:
      try:
        kpis = BacktestKpis.model_validate(report.content.get("kpis"))
      except Exception:
        kpis = None

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


@router.get("/{run_id}/artifacts/{name}")
async def get_artifact(run_id: uuid.UUID, name: str, db: AsyncSession = Depends(get_db)) -> ORJSONResponse:
  art = (await db.execute(select(RunArtifact).where(RunArtifact.run_id == run_id, RunArtifact.name == name))).scalar_one_or_none()
  if art is None:
    return error_response("DATA_UNAVAILABLE", "artifact not found", {"run_id": str(run_id), "name": name}, status=404)
  return ORJSONResponse({"name": art.name, "type": art.type, "uri": art.uri, "content": art.content})


class DeployRequest(BaseModel):
  mode: str


@router.post("/{run_id}/deploy")
async def deploy(run_id: uuid.UUID, _: DeployRequest, db: AsyncSession = Depends(get_db)) -> dict[str, str]:
  run = (await db.execute(select(Run).where(Run.id == run_id))).scalar_one_or_none()
  if run is None:
    raise AppError("DATA_UNAVAILABLE", "run not found", {"run_id": str(run_id)}, http_status=404)
  return {"deployId": str(run_id), "status": "queued"}
