from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ErrorObject(BaseModel):
  code: Literal["VALIDATION_ERROR", "DATA_UNAVAILABLE", "EXECUTION_GUARD_BLOCKED", "INTERNAL", "UNAUTHORIZED"]
  message: str
  details: dict[str, Any] = Field(default_factory=dict)


class LogEntry(BaseModel):
  ts: datetime
  level: Literal["DEBUG", "INFO", "WARN", "ERROR"]
  msg: str
  kv: dict[str, Any] = Field(default_factory=dict)


class ArtifactRef(BaseModel):
  id: str
  type: Literal["json", "markdown", "image", "csv", "binary"]
  name: str
  uri: str


class WorkspaceStep(BaseModel):
  id: Literal["parse", "plan", "data", "backtest", "report", "deploy"]
  state: Literal["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"]
  label: str
  logs: list[LogEntry] = Field(default_factory=list)


class NaturalLanguageStrategyRequest(BaseModel):
  input_type: Literal["NATURAL_LANGUAGE"] = "NATURAL_LANGUAGE"
  nl: str = Field(min_length=1)
  mode: Literal["BACKTEST_ONLY", "PAPER", "LIVE"]
  as_of: datetime | None = None
  start_date: date = Field(default=date(2025, 1, 1))
  end_date: date = Field(default=date(2025, 12, 31))
  overrides: dict[str, Any] | None = None


class CreateRunResponse(BaseModel):
  run_id: str
  status: Literal["accepted"] = "accepted"
  message: str


class RunStatusResponse(BaseModel):
  run_id: str
  state: Literal["running", "completed", "failed"]
  progress: int = Field(ge=0, le=100)
  steps: list[WorkspaceStep]
  artifacts: list[ArtifactRef] = Field(default_factory=list)


class EquityPoint(BaseModel):
  t: datetime
  v: float


class BacktestKpis(BaseModel):
  return_pct: float
  cagr_pct: float
  sharpe: float
  max_dd_pct: float
  trades: int
  win_rate: float
  avg_holding_days: float


class BacktestTrade(BaseModel):
  decision_time: datetime
  fill_time: datetime
  symbol: str
  side: Literal["BUY", "SELL"]
  qty: float
  fill_price: float
  cost: dict[str, Any]
  why: dict[str, Any]
  pnl: float | None = None
  pnl_pct: float | None = None


class BacktestReportResponse(BaseModel):
  kpis: BacktestKpis
  equity: list[EquityPoint]
  trades: list[BacktestTrade]


class RunHistoryEntry(BaseModel):
  run_id: str
  strategy_id: str
  prompt: str | None = None
  state: Literal["completed", "failed"]
  completed_at: datetime
  kpis: BacktestKpis | None = None
  artifacts: dict[str, str] = Field(default_factory=dict)


class RunHistoryResponse(BaseModel):
  history: list[RunHistoryEntry]
