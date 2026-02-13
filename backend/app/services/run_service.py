from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi.encoders import jsonable_encoder
import redis.asyncio as redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.config import settings
from app.db.engine import SessionLocal
from app.db.models import Run, RunArtifact, RunStep, Strategy, Trade
from app.schemas.contracts import NaturalLanguageStrategyRequest
from app.services.backtest_engine import run_backtest_from_spec
from app.services.storage_service import upload_artifact_content, storage_enabled
from app.services.spec_builder import nl_to_strategy_spec

logger = logging.getLogger(__name__)

StepId = Literal["parse", "plan", "data", "backtest", "report", "deploy"]

STEP_LABELS: dict[StepId, str] = {
  "parse": "Parse Strategy",
  "plan": "Build Execution Plan",
  "data": "Fetch & Validate Data",
  "backtest": "Backtest Engine",
  "report": "Generate Report",
  "deploy": "Deploy",
}

def _now() -> datetime:
  return datetime.now(timezone.utc)


def _log(level: Literal["DEBUG", "INFO", "WARN", "ERROR"], msg: str, kv: dict[str, Any] | None = None) -> dict[str, Any]:
  return {"ts": _now().isoformat(), "level": level, "msg": msg, "kv": kv or {}}


def _queue_dedupe_key(run_id: uuid.UUID) -> str:
  return f"vibe:run:queued:{run_id}"


async def _clear_queue_lock(run_id: uuid.UUID) -> None:
  if not settings.task_queue_enabled:
    return
  if not settings.redis_url:
    return
  try:
    client = redis.from_url(settings.redis_url, decode_responses=True)
    await client.delete(_queue_dedupe_key(run_id))
    await client.aclose()
  except Exception:
    logger.exception("run_queue_lock_clear_failed", extra={"run_id": str(run_id)})


async def _set_step_state(
  db: AsyncSession,
  run_id: uuid.UUID,
  step_id: StepId,
  state: str,
  log: dict[str, Any] | None = None,
) -> None:
  step = (await db.execute(select(RunStep).where(RunStep.run_id == run_id, RunStep.step_id == step_id))).scalar_one()
  step.state = state
  if log is not None:
    step.logs = [*step.logs, log]
  await db.commit()


async def _upsert_artifact(db: AsyncSession, run_id: uuid.UUID, name: str, type_: str, uri: str, content: dict[str, Any] | None = None) -> None:
  persisted_uri = uri
  persisted_content: dict[str, Any] | None = content
  if storage_enabled() and content is not None:
    storage_uri = await upload_artifact_content(run_id=run_id, name=name, type_=type_, content=content)
    if storage_uri is not None:
      persisted_uri = storage_uri
      persisted_content = None

  row = (
    await db.execute(select(RunArtifact).where(RunArtifact.run_id == run_id, RunArtifact.name == name))
  ).scalar_one_or_none()
  if row is None:
    row = RunArtifact(run_id=run_id, name=name, type=type_, uri=persisted_uri, content=persisted_content)
    db.add(row)
  else:
    row.type = type_
    row.uri = persisted_uri
    row.content = persisted_content
  try:
    await db.commit()
  except Exception:
    await db.rollback()
    raise


async def create_run(db: AsyncSession, req: NaturalLanguageStrategyRequest, *, user_id: uuid.UUID) -> Run:
  spec = await nl_to_strategy_spec(req.nl, req.mode, overrides=req.overrides)
  if not isinstance(spec, dict):
    raise AppError("VALIDATION_ERROR", "StrategySpec must be an object", {"type": str(type(spec))})

  if spec.get("strategy_version") in (None, ""):
    spec["strategy_version"] = "v0"

  strategy = Strategy(
    name=str(spec.get("name") or "Untitled"),
    strategy_version=str(spec["strategy_version"]),
    prompt=req.nl,
    spec=spec,
    user_id=user_id,
  )
  db.add(strategy)
  await db.flush()

  run = Run(strategy_id=strategy.id, mode=req.mode, state="running", user_id=user_id)
  db.add(run)
  await db.flush()

  steps: list[RunStep] = []
  for sid in ["parse", "plan", "data", "backtest", "report", "deploy"]:
    state = "PENDING"
    if sid == "deploy" and req.mode == "BACKTEST_ONLY":
      state = "SKIPPED"
    steps.append(RunStep(run_id=run.id, step_id=sid, label=STEP_LABELS[sid], state=state, logs=[]))  # type: ignore[arg-type]
  db.add_all(steps)
  db.add(
    RunArtifact(
      run_id=run.id,
      name="request.json",
      type="json",
      uri=f"/api/runs/{run.id}/artifacts/request.json",
      content={
        "start_date": req.start_date.isoformat(),
        "end_date": req.end_date.isoformat(),
        "mode": req.mode,
      },
    )
  )
  await db.commit()

  return run


async def execute_run(
  run_id: uuid.UUID,
  start_date: str = "2025-01-01",
  end_date: str = "2025-12-31",
) -> None:
  async with SessionLocal() as db:
    run = (await db.execute(select(Run).where(Run.id == run_id))).scalar_one_or_none()
    if run is None:
      return

    strategy = (await db.execute(select(Strategy).where(Strategy.id == run.strategy_id))).scalar_one()
    spec = strategy.spec

    try:
      await _set_step_state(
        db,
        run_id,
        "parse",
        "RUNNING",
        _log("INFO", "Parsing strategy spec", {"model": settings.llm_model}),
      )
      await _upsert_artifact(db, run_id, "dsl.json", "json", f"/api/runs/{run_id}/artifacts/dsl.json", content=spec)
      await _set_step_state(db, run_id, "parse", "RUNNING", _log("INFO", "DSL artifact persisted"))
      inputs_snapshot = {
        "strategy_version": strategy.strategy_version,
        "resolved_universe": spec.get("universe"),
        "resolved_calendar": spec.get("calendar"),
        "execution_model": (spec.get("execution") or {}).get("model"),
      }
      await _upsert_artifact(
        db,
        run_id,
        "inputs_snapshot.json",
        "json",
        f"/api/runs/{run_id}/artifacts/inputs_snapshot.json",
        content=inputs_snapshot,
      )
      await _set_step_state(db, run_id, "parse", "RUNNING", _log("INFO", "Input snapshot generated"))
      await _set_step_state(
        db,
        run_id,
        "parse",
        "DONE",
        _log(
          "INFO",
          "StrategySpec ready",
          {
            "strategy_version": strategy.strategy_version,
            "model": settings.llm_model,
            "llm_used": bool((spec.get("meta") or {}).get("llm_used")),
            "llm_attempts": int((spec.get("meta") or {}).get("llm_attempts") or 1),
          },
        ),
      )

      await _set_step_state(db, run_id, "plan", "RUNNING", _log("INFO", "Building execution plan"))
      plan = {
        "version": "v0",
        "decision_schedule": {"type": "MARKET_CLOSE_OFFSET", "offset": "-2m", "timezone": "America/New_York"},
        "nodes": [],
      }
      await _upsert_artifact(db, run_id, "plan.json", "json", f"/api/runs/{run_id}/artifacts/plan.json", content=plan)
      await _set_step_state(db, run_id, "plan", "DONE", _log("INFO", "ExecutionPlan compiled"))

      await _set_step_state(db, run_id, "data", "RUNNING", _log("INFO", "Fetching minute data"))
      await _set_step_state(db, run_id, "data", "RUNNING", _log("INFO", "Validating session coverage"))
      await _set_step_state(
        db,
        run_id,
        "data",
        "DONE",
        _log("INFO", "Data ready", {"start_date": start_date, "end_date": end_date}),
      )

      await _set_step_state(
        db,
        run_id,
        "backtest",
        "RUNNING",
        _log("INFO", "Running backtest", {"start_date": start_date, "end_date": end_date}),
      )
      backtest_step = (await db.execute(select(RunStep).where(RunStep.run_id == run_id, RunStep.step_id == "backtest"))).scalar_one()
      last_persisted = 0

      async def _on_backtest_progress(done: int, total: int, session_close: datetime) -> None:
        nonlocal last_persisted
        if total <= 0:
          return
        ratio = min(max(done / total, 0.0), 1.0)
        target = int(ratio * 100.0)
        should_persist = done == total or done == 1 or done - last_persisted >= 5
        if not should_persist:
          return

        pct = round(ratio * 100.0, 1)
        progress_log = _log(
          "INFO",
          "Backtest progress",
          {"session_date": session_close.date().isoformat(), "processed": done, "total": total, "pct": pct},
        )
        logs = list(backtest_step.logs or [])
        if logs and isinstance(logs[-1], dict) and logs[-1].get("msg") == "Backtest progress":
          logs[-1] = progress_log
        else:
          logs = [*logs[-20:], progress_log]
        backtest_step.logs = logs
        last_persisted = done
        await db.commit()

      result = await run_backtest_from_spec(spec, start_date=start_date, end_date=end_date, progress_hook=_on_backtest_progress)
      resolved = (result.artifacts or {}).get("resolved") if isinstance(result.artifacts, dict) else {}
      universe = (resolved or {}).get("universe") if isinstance(resolved, dict) else {}
      await _set_step_state(
        db,
        run_id,
        "backtest",
        "DONE",
        _log(
          "INFO",
          "Backtest completed",
          {
            "trades": len(result.trades),
            "signal_symbol": (universe or {}).get("signal_symbol"),
            "trade_symbol": (universe or {}).get("trade_symbol"),
            "return_pct": result.kpis.get("return_pct"),
            "max_dd_pct": result.kpis.get("max_dd_pct"),
          },
        ),
      )

      await _set_step_state(db, run_id, "report", "RUNNING", _log("INFO", "Generating report"))
      report = jsonable_encoder({"kpis": result.kpis, "equity": result.equity, "trades": result.trades})
      await _upsert_artifact(db, run_id, "report.json", "json", f"/api/runs/{run_id}/report", content=report)
      await _set_step_state(db, run_id, "report", "RUNNING", _log("INFO", "Report artifact persisted"))
      await _upsert_artifact(
        db,
        run_id,
        "kpis.json",
        "json",
        f"/api/runs/{run_id}/artifacts/kpis.json",
        content={"kpis": result.kpis},
      )
      await _set_step_state(db, run_id, "report", "RUNNING", _log("INFO", "KPI snapshot generated"))
      report_md = f"# Backtest Report\n\n- Trades: {len(result.trades)}\n- Return%: {result.kpis.get('return_pct'):.2f}\n- Sharpe: {result.kpis.get('sharpe'):.2f}\n- MaxDD%: {result.kpis.get('max_dd_pct'):.2f}\n"
      await _upsert_artifact(db, run_id, "report.md", "markdown", f"/api/runs/{run_id}/artifacts/report.md", content={"markdown": report_md})
      await _upsert_artifact(db, run_id, "equity.png", "image", f"/api/runs/{run_id}/artifacts/equity.png", content=None)
      csv_lines = ["decision_time,fill_time,symbol,side,qty,fill_price"]
      for t in result.trades:
        csv_lines.append(
          f"{t['decision_time'].isoformat()},{t['fill_time'].isoformat()},{t['symbol']},{t['side']},{t['qty']},{t['fill_price']}"
        )
      await _upsert_artifact(
        db,
        run_id,
        "trades.csv",
        "csv",
        f"/api/runs/{run_id}/artifacts/trades.csv",
        content={"csv": "\n".join(csv_lines)},
      )
      await _set_step_state(db, run_id, "report", "DONE", _log("INFO", "Report ready"))

      for t in result.trades:
        tr = Trade(
          run_id=run_id,
          decision_time=t["decision_time"],
          fill_time=t["fill_time"],
          symbol=t["symbol"],
          side=t["side"],
          qty=float(t["qty"]),
          fill_price=float(t["fill_price"]),
          cost=t["cost"],
          why=t["why"],
        )
        db.add(tr)
      await db.commit()

      if run.mode != "BACKTEST_ONLY":
        await _set_step_state(db, run_id, "deploy", "PENDING", _log("INFO", "Awaiting confirm"))

      run.state = "completed"
      await db.commit()
    except AppError as e:
      logger.exception("run_failed", extra={"run_id": str(run_id), "code": e.code})
      run.state = "failed"
      run.error = {"code": e.code, "message": e.message, "details": e.details or {}}
      await db.commit()
      try:
        await _set_step_state(
          db,
          run_id,
          "backtest",
          "FAILED",
          _log("ERROR", "Run failed", {"code": e.code, "message": e.message}),
        )
      except Exception:
        pass
    except Exception as e:
      logger.exception("run_crash", extra={"run_id": str(run_id)})
      run.state = "failed"
      run.error = {"code": "INTERNAL", "message": "Unhandled error", "details": {"error": str(e)}}
      await db.commit()
      try:
        await _set_step_state(
          db,
          run_id,
          "backtest",
          "FAILED",
          _log("ERROR", "Unhandled failure", {"error": str(e)}),
        )
      except Exception:
        pass
    finally:
      await _clear_queue_lock(run_id)
