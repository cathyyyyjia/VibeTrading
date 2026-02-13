from __future__ import annotations

from alembic import op


revision = "0002_add_rls_policies"
down_revision = "0001_init_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.execute(
    """
    DROP POLICY IF EXISTS alembic_version_no_client_access ON public.alembic_version;
    DROP POLICY IF EXISTS users_select_own ON public.users;
    DROP POLICY IF EXISTS users_insert_own ON public.users;
    DROP POLICY IF EXISTS users_update_own ON public.users;
    DROP POLICY IF EXISTS oauth_identities_select_own ON public.oauth_identities;
    DROP POLICY IF EXISTS oauth_identities_insert_own ON public.oauth_identities;
    DROP POLICY IF EXISTS oauth_identities_update_own ON public.oauth_identities;
    DROP POLICY IF EXISTS strategies_select_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_insert_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_update_own ON public.strategies;
    DROP POLICY IF EXISTS runs_select_own ON public.runs;
    DROP POLICY IF EXISTS runs_insert_own ON public.runs;
    DROP POLICY IF EXISTS runs_update_own ON public.runs;
    DROP POLICY IF EXISTS run_steps_select_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_insert_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_update_own ON public.run_steps;
    DROP POLICY IF EXISTS run_artifacts_select_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_insert_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_update_own ON public.run_artifacts;
    DROP POLICY IF EXISTS trades_select_own ON public.trades;
    DROP POLICY IF EXISTS trades_insert_own ON public.trades;
    DROP POLICY IF EXISTS trades_update_own ON public.trades;

    ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.oauth_identities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.strategies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.run_steps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.run_artifacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

    CREATE POLICY alembic_version_no_client_access ON public.alembic_version
      FOR ALL USING (false) WITH CHECK (false);

    CREATE POLICY users_select_own ON public.users
      FOR SELECT USING (id = auth.uid());
    CREATE POLICY users_insert_own ON public.users
      FOR INSERT WITH CHECK (id = auth.uid());
    CREATE POLICY users_update_own ON public.users
      FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

    CREATE POLICY oauth_identities_select_own ON public.oauth_identities
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY oauth_identities_insert_own ON public.oauth_identities
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY oauth_identities_update_own ON public.oauth_identities
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

    CREATE POLICY strategies_select_own ON public.strategies
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY strategies_insert_own ON public.strategies
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY strategies_update_own ON public.strategies
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

    CREATE POLICY runs_select_own ON public.runs
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY runs_insert_own ON public.runs
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY runs_update_own ON public.runs
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

    CREATE POLICY run_steps_select_own ON public.run_steps
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY run_steps_insert_own ON public.run_steps
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY run_steps_update_own ON public.run_steps
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = auth.uid())
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = auth.uid())
      );

    CREATE POLICY run_artifacts_select_own ON public.run_artifacts
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY run_artifacts_insert_own ON public.run_artifacts
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY run_artifacts_update_own ON public.run_artifacts
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = auth.uid())
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = auth.uid())
      );

    CREATE POLICY trades_select_own ON public.trades
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY trades_insert_own ON public.trades
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = auth.uid())
      );
    CREATE POLICY trades_update_own ON public.trades
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = auth.uid())
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = auth.uid())
      );
    """
  )


def downgrade() -> None:
  op.execute(
    """
    DROP POLICY IF EXISTS trades_update_own ON public.trades;
    DROP POLICY IF EXISTS trades_insert_own ON public.trades;
    DROP POLICY IF EXISTS trades_select_own ON public.trades;

    DROP POLICY IF EXISTS run_artifacts_update_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_insert_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_select_own ON public.run_artifacts;

    DROP POLICY IF EXISTS run_steps_update_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_insert_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_select_own ON public.run_steps;

    DROP POLICY IF EXISTS runs_update_own ON public.runs;
    DROP POLICY IF EXISTS runs_insert_own ON public.runs;
    DROP POLICY IF EXISTS runs_select_own ON public.runs;

    DROP POLICY IF EXISTS strategies_update_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_insert_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_select_own ON public.strategies;

    DROP POLICY IF EXISTS oauth_identities_update_own ON public.oauth_identities;
    DROP POLICY IF EXISTS oauth_identities_insert_own ON public.oauth_identities;
    DROP POLICY IF EXISTS oauth_identities_select_own ON public.oauth_identities;

    DROP POLICY IF EXISTS users_update_own ON public.users;
    DROP POLICY IF EXISTS users_insert_own ON public.users;
    DROP POLICY IF EXISTS users_select_own ON public.users;

    DROP POLICY IF EXISTS alembic_version_no_client_access ON public.alembic_version;
    """
  )
