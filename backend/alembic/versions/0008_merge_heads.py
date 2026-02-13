"""Merge parallel 0007 migration heads.

Revision ID: 0008_merge_heads
Revises: 0007_drop_runs_progress, 0007_rls_auth_uid_initplan
Create Date: 2026-02-13
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0008_merge_heads"
down_revision = ("0007_drop_runs_progress", "0007_rls_auth_uid_initplan")
branch_labels = None
depends_on = None


def upgrade() -> None:
  pass


def downgrade() -> None:
  pass
