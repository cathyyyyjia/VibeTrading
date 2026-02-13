from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_drop_runs_progress"
down_revision = "0006_users_fk_to_auth_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.drop_column("runs", "progress", schema="public")


def downgrade() -> None:
  op.add_column("runs", sa.Column("progress", sa.Integer(), nullable=False, server_default="0"), schema="public")
  op.alter_column("runs", "progress", server_default=None, schema="public")

