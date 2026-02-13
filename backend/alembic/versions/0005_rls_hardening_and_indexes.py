from __future__ import annotations

from alembic import op


revision = "0005_rls_hardening_and_indexes"
down_revision = "0004_drop_oauth_identities"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.execute(
    """
    CREATE INDEX IF NOT EXISTS ix_runs_user_state_updated_at
      ON public.runs (user_id, state, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ix_strategies_user_created_at
      ON public.strategies (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ix_run_steps_run_updated_at
      ON public.run_steps (run_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ix_run_artifacts_run_created_at
      ON public.run_artifacts (run_id, created_at DESC);
    """
  )

  op.execute(
    """
    DROP POLICY IF EXISTS users_delete_own ON public.users;
    DROP POLICY IF EXISTS strategies_delete_own ON public.strategies;
    DROP POLICY IF EXISTS runs_delete_own ON public.runs;
    DROP POLICY IF EXISTS run_steps_delete_own ON public.run_steps;
    DROP POLICY IF EXISTS run_artifacts_delete_own ON public.run_artifacts;
    DROP POLICY IF EXISTS trades_delete_own ON public.trades;

    CREATE POLICY users_delete_own ON public.users
      FOR DELETE USING (id = auth.uid());
    CREATE POLICY strategies_delete_own ON public.strategies
      FOR DELETE USING (user_id = auth.uid());
    CREATE POLICY runs_delete_own ON public.runs
      FOR DELETE USING (user_id = auth.uid());
    CREATE POLICY run_steps_delete_own ON public.run_steps
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY run_artifacts_delete_own ON public.run_artifacts
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY trades_delete_own ON public.trades
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = auth.uid())
      );
    """
  )

  op.execute(
    """
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vibe_backend') THEN
        CREATE ROLE vibe_backend NOLOGIN;
      END IF;
    END $$;

    GRANT USAGE ON SCHEMA public TO vibe_backend;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE
        public.users,
        public.strategies,
        public.runs,
        public.run_steps,
        public.run_artifacts,
        public.trades
      TO vibe_backend;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vibe_backend;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vibe_backend;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO vibe_backend;
    """
  )


def downgrade() -> None:
  op.execute(
    """
    DROP POLICY IF EXISTS trades_delete_own ON public.trades;
    DROP POLICY IF EXISTS run_artifacts_delete_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_steps_delete_own ON public.run_steps;
    DROP POLICY IF EXISTS runs_delete_own ON public.runs;
    DROP POLICY IF EXISTS strategies_delete_own ON public.strategies;
    DROP POLICY IF EXISTS users_delete_own ON public.users;
    """
  )

  op.execute(
    """
    DROP INDEX IF EXISTS public.ix_run_artifacts_run_created_at;
    DROP INDEX IF EXISTS public.ix_run_steps_run_updated_at;
    DROP INDEX IF EXISTS public.ix_strategies_user_created_at;
    DROP INDEX IF EXISTS public.ix_runs_user_state_updated_at;
    """
  )
