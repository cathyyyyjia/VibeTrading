from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
  return datetime.now(timezone.utc)

JsonType = JSON().with_variant(JSONB, "postgresql")


RunMode = Literal["BACKTEST_ONLY", "PAPER", "LIVE"]
RunState = Literal["running", "completed", "failed"]
StepState = Literal["PENDING", "RUNNING", "DONE", "FAILED", "SKIPPED"]


class User(Base):
  __tablename__ = "users"

  id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("auth.users.id", ondelete="CASCADE"), primary_key=True)
  email: Mapped[str | None] = mapped_column(Text, nullable=True)
  name: Mapped[str | None] = mapped_column(Text, nullable=True)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
  last_signed_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

  strategies: Mapped[list["Strategy"]] = relationship(back_populates="user")
  runs: Mapped[list["Run"]] = relationship(back_populates="user")


class Strategy(Base):
  __tablename__ = "strategies"

  id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
  name: Mapped[str] = mapped_column(String(256), nullable=False)
  strategy_version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
  prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
  spec: Mapped[dict[str, Any]] = mapped_column(JsonType, nullable=False)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

  user: Mapped["User | None"] = relationship(back_populates="strategies")
  runs: Mapped[list["Run"]] = relationship(back_populates="strategy", cascade="all, delete-orphan")


class Run(Base):
  __tablename__ = "runs"

  id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
  user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
  strategy_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("strategies.id"), nullable=False, index=True)
  mode: Mapped[str] = mapped_column(String(16), nullable=False)
  state: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
  progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
  error: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

  user: Mapped["User | None"] = relationship(back_populates="runs")
  strategy: Mapped["Strategy"] = relationship(back_populates="runs")
  steps: Mapped[list["RunStep"]] = relationship(back_populates="run", cascade="all, delete-orphan")
  artifacts: Mapped[list["RunArtifact"]] = relationship(back_populates="run", cascade="all, delete-orphan")
  trades: Mapped[list["Trade"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class RunStep(Base):
  __tablename__ = "run_steps"

  id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
  run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"), nullable=False, index=True)
  step_id: Mapped[str] = mapped_column(String(32), nullable=False)
  label: Mapped[str] = mapped_column(String(64), nullable=False)
  state: Mapped[str] = mapped_column(String(16), nullable=False)
  logs: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, nullable=False, default=list)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

  run: Mapped["Run"] = relationship(back_populates="steps")

  __table_args__ = (Index("ix_run_steps_run_id_step_id", "run_id", "step_id", unique=True),)


class RunArtifact(Base):
  __tablename__ = "run_artifacts"

  id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
  run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"), nullable=False, index=True)
  name: Mapped[str] = mapped_column(String(128), nullable=False)
  type: Mapped[str] = mapped_column(String(32), nullable=False)
  uri: Mapped[str] = mapped_column(Text, nullable=False)
  content: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

  run: Mapped["Run"] = relationship(back_populates="artifacts")

  __table_args__ = (Index("ix_run_artifacts_run_id_name", "run_id", "name", unique=True),)


class Trade(Base):
  __tablename__ = "trades"

  id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
  run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id"), nullable=False, index=True)
  action_id: Mapped[str] = mapped_column(String(64), nullable=False, default="sell_trade_symbol_partial")
  decision_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
  fill_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
  symbol: Mapped[str] = mapped_column(String(16), nullable=False)
  side: Mapped[str] = mapped_column(String(8), nullable=False)
  qty: Mapped[float] = mapped_column(nullable=False)
  fill_price: Mapped[float] = mapped_column(nullable=False)
  cost: Mapped[dict[str, Any]] = mapped_column(JsonType, nullable=False, default=dict)
  why: Mapped[dict[str, Any]] = mapped_column(JsonType, nullable=False, default=dict)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

  run: Mapped["Run"] = relationship(back_populates="trades")
