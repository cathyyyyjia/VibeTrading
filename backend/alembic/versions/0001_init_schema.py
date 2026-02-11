from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0001_init_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
  json_t = sa.JSON().with_variant(postgresql.JSONB, "postgresql")
  uuid_t = sa.Uuid(as_uuid=True)

  op.create_table(
    "users",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("email", sa.Text(), nullable=True),
    sa.Column("name", sa.Text(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("last_signed_in_at", sa.DateTime(timezone=True), nullable=True),
  )

  op.create_table(
    "oauth_identities",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("user_id", uuid_t, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    sa.Column("provider", sa.String(length=32), nullable=False),
    sa.Column("subject", sa.String(length=256), nullable=False),
    sa.Column("email", sa.Text(), nullable=True),
    sa.Column("profile", json_t, nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
  )
  op.create_index("ix_oauth_identities_user_id", "oauth_identities", ["user_id"])
  op.create_index(
    "ix_oauth_identities_provider_subject",
    "oauth_identities",
    ["provider", "subject"],
    unique=True,
  )

  op.create_table(
    "strategies",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("user_id", uuid_t, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    sa.Column("name", sa.String(length=256), nullable=False),
    sa.Column("strategy_version", sa.String(length=64), nullable=False),
    sa.Column("prompt", sa.Text(), nullable=True),
    sa.Column("spec", json_t, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
  )
  op.create_index("ix_strategies_user_id", "strategies", ["user_id"])
  op.create_index("ix_strategies_strategy_version", "strategies", ["strategy_version"])

  op.create_table(
    "runs",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("user_id", uuid_t, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    sa.Column("strategy_id", uuid_t, sa.ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False),
    sa.Column("mode", sa.String(length=16), nullable=False),
    sa.Column("state", sa.String(length=16), nullable=False),
    sa.Column("progress", sa.Integer(), nullable=False),
    sa.Column("error", json_t, nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
  )
  op.create_index("ix_runs_user_id", "runs", ["user_id"])
  op.create_index("ix_runs_strategy_id", "runs", ["strategy_id"])

  op.create_table(
    "run_steps",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("run_id", uuid_t, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("step_id", sa.String(length=32), nullable=False),
    sa.Column("label", sa.String(length=64), nullable=False),
    sa.Column("state", sa.String(length=16), nullable=False),
    sa.Column("logs", json_t, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
  )
  op.create_index("ix_run_steps_run_id", "run_steps", ["run_id"])
  op.create_index("ix_run_steps_run_id_step_id", "run_steps", ["run_id", "step_id"], unique=True)

  op.create_table(
    "run_artifacts",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("run_id", uuid_t, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("name", sa.String(length=128), nullable=False),
    sa.Column("type", sa.String(length=32), nullable=False),
    sa.Column("uri", sa.Text(), nullable=False),
    sa.Column("content", json_t, nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
  )
  op.create_index("ix_run_artifacts_run_id", "run_artifacts", ["run_id"])
  op.create_index("ix_run_artifacts_run_id_name", "run_artifacts", ["run_id", "name"], unique=True)

  op.create_table(
    "trades",
    sa.Column("id", uuid_t, primary_key=True, nullable=False),
    sa.Column("run_id", uuid_t, sa.ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
    sa.Column("action_id", sa.String(length=64), nullable=False),
    sa.Column("decision_time", sa.DateTime(timezone=True), nullable=False),
    sa.Column("fill_time", sa.DateTime(timezone=True), nullable=False),
    sa.Column("symbol", sa.String(length=16), nullable=False),
    sa.Column("side", sa.String(length=8), nullable=False),
    sa.Column("qty", sa.Float(), nullable=False),
    sa.Column("fill_price", sa.Float(), nullable=False),
    sa.Column("cost", json_t, nullable=False),
    sa.Column("why", json_t, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
  )
  op.create_index("ix_trades_run_id", "trades", ["run_id"])


def downgrade() -> None:
  op.drop_index("ix_trades_run_id", table_name="trades")
  op.drop_table("trades")

  op.drop_index("ix_run_artifacts_run_id_name", table_name="run_artifacts")
  op.drop_index("ix_run_artifacts_run_id", table_name="run_artifacts")
  op.drop_table("run_artifacts")

  op.drop_index("ix_run_steps_run_id_step_id", table_name="run_steps")
  op.drop_index("ix_run_steps_run_id", table_name="run_steps")
  op.drop_table("run_steps")

  op.drop_index("ix_runs_strategy_id", table_name="runs")
  op.drop_index("ix_runs_user_id", table_name="runs")
  op.drop_table("runs")

  op.drop_index("ix_strategies_strategy_version", table_name="strategies")
  op.drop_index("ix_strategies_user_id", table_name="strategies")
  op.drop_table("strategies")

  op.drop_index("ix_oauth_identities_provider_subject", table_name="oauth_identities")
  op.drop_index("ix_oauth_identities_user_id", table_name="oauth_identities")
  op.drop_table("oauth_identities")

  op.drop_table("users")

