from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "0004_drop_oauth_identities"
down_revision = "0003_align_user_ids_and_realtime"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.execute(
    """
    DO $$
    BEGIN
      IF to_regclass('public.oauth_identities') IS NOT NULL THEN
        DROP POLICY IF EXISTS oauth_identities_update_own ON public.oauth_identities;
        DROP POLICY IF EXISTS oauth_identities_insert_own ON public.oauth_identities;
        DROP POLICY IF EXISTS oauth_identities_select_own ON public.oauth_identities;
        DROP TABLE public.oauth_identities;
      END IF;
    END $$;
    """
  )


def downgrade() -> None:
  json_t = sa.JSON().with_variant(postgresql.JSONB, "postgresql")
  uuid_t = sa.Uuid(as_uuid=True)

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
  op.create_index("ix_oauth_identities_provider_subject", "oauth_identities", ["provider", "subject"], unique=True)

  op.execute(
    """
    ALTER TABLE public.oauth_identities ENABLE ROW LEVEL SECURITY;

    CREATE POLICY oauth_identities_select_own ON public.oauth_identities
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY oauth_identities_insert_own ON public.oauth_identities
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY oauth_identities_update_own ON public.oauth_identities
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    """
  )
