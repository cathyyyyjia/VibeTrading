from __future__ import annotations

from alembic import op


revision = "0007_rls_auth_uid_initplan"
down_revision = "0006_users_fk_to_auth_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.execute(
    """
    -- users
    DROP POLICY IF EXISTS users_select_own ON public.users;
    DROP POLICY IF EXISTS users_insert_own ON public.users;
    DROP POLICY IF EXISTS users_update_own ON public.users;
    DROP POLICY IF EXISTS users_delete_own ON public.users;
    CREATE POLICY users_select_own ON public.users
      FOR SELECT USING (id = (select auth.uid()));
    CREATE POLICY users_insert_own ON public.users
      FOR INSERT WITH CHECK (id = (select auth.uid()));
    CREATE POLICY users_update_own ON public.users
      FOR UPDATE USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));
    CREATE POLICY users_delete_own ON public.users
      FOR DELETE USING (id = (select auth.uid()));

    -- strategies
    DROP POLICY IF EXISTS strategies_select_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_insert_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_update_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_delete_own ON public.strategies;
    CREATE POLICY strategies_select_own ON public.strategies
      FOR SELECT USING (user_id = (select auth.uid()));
    CREATE POLICY strategies_insert_own ON public.strategies
      FOR INSERT WITH CHECK (user_id = (select auth.uid()));
    CREATE POLICY strategies_update_own ON public.strategies
      FOR UPDATE USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
    CREATE POLICY strategies_delete_own ON public.strategies
      FOR DELETE USING (user_id = (select auth.uid()));

    -- runs
    DROP POLICY IF EXISTS runs_select_own ON public.runs;
    DROP POLICY IF EXISTS runs_insert_own ON public.runs;
    DROP POLICY IF EXISTS runs_update_own ON public.runs;
    DROP POLICY IF EXISTS runs_delete_own ON public.runs;
    CREATE POLICY runs_select_own ON public.runs
      FOR SELECT USING (user_id = (select auth.uid()));
    CREATE POLICY runs_insert_own ON public.runs
      FOR INSERT WITH CHECK (user_id = (select auth.uid()));
    CREATE POLICY runs_update_own ON public.runs
      FOR UPDATE USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
    CREATE POLICY runs_delete_own ON public.runs
      FOR DELETE USING (user_id = (select auth.uid()));

    -- run_steps
    DROP POLICY IF EXISTS run_steps_select_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_insert_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_update_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_delete_own ON public.run_steps;
    CREATE POLICY run_steps_select_own ON public.run_steps
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY run_steps_insert_own ON public.run_steps
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY run_steps_update_own ON public.run_steps
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = (select auth.uid()))
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY run_steps_delete_own ON public.run_steps
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = (select auth.uid()))
      );

    -- run_artifacts
    DROP POLICY IF EXISTS run_artifacts_select_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_insert_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_update_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_delete_own ON public.run_artifacts;
    CREATE POLICY run_artifacts_select_own ON public.run_artifacts
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY run_artifacts_insert_own ON public.run_artifacts
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY run_artifacts_update_own ON public.run_artifacts
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = (select auth.uid()))
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY run_artifacts_delete_own ON public.run_artifacts
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = (select auth.uid()))
      );

    -- trades
    DROP POLICY IF EXISTS trades_select_own ON public.trades;
    DROP POLICY IF EXISTS trades_insert_own ON public.trades;
    DROP POLICY IF EXISTS trades_update_own ON public.trades;
    DROP POLICY IF EXISTS trades_delete_own ON public.trades;
    CREATE POLICY trades_select_own ON public.trades
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY trades_insert_own ON public.trades
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY trades_update_own ON public.trades
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = (select auth.uid()))
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = (select auth.uid()))
      );
    CREATE POLICY trades_delete_own ON public.trades
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = (select auth.uid()))
      );
    """
  )


def downgrade() -> None:
  op.execute(
    """
    -- users
    DROP POLICY IF EXISTS users_select_own ON public.users;
    DROP POLICY IF EXISTS users_insert_own ON public.users;
    DROP POLICY IF EXISTS users_update_own ON public.users;
    DROP POLICY IF EXISTS users_delete_own ON public.users;
    CREATE POLICY users_select_own ON public.users
      FOR SELECT USING (id = auth.uid());
    CREATE POLICY users_insert_own ON public.users
      FOR INSERT WITH CHECK (id = auth.uid());
    CREATE POLICY users_update_own ON public.users
      FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
    CREATE POLICY users_delete_own ON public.users
      FOR DELETE USING (id = auth.uid());

    -- strategies
    DROP POLICY IF EXISTS strategies_select_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_insert_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_update_own ON public.strategies;
    DROP POLICY IF EXISTS strategies_delete_own ON public.strategies;
    CREATE POLICY strategies_select_own ON public.strategies
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY strategies_insert_own ON public.strategies
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY strategies_update_own ON public.strategies
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    CREATE POLICY strategies_delete_own ON public.strategies
      FOR DELETE USING (user_id = auth.uid());

    -- runs
    DROP POLICY IF EXISTS runs_select_own ON public.runs;
    DROP POLICY IF EXISTS runs_insert_own ON public.runs;
    DROP POLICY IF EXISTS runs_update_own ON public.runs;
    DROP POLICY IF EXISTS runs_delete_own ON public.runs;
    CREATE POLICY runs_select_own ON public.runs
      FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY runs_insert_own ON public.runs
      FOR INSERT WITH CHECK (user_id = auth.uid());
    CREATE POLICY runs_update_own ON public.runs
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    CREATE POLICY runs_delete_own ON public.runs
      FOR DELETE USING (user_id = auth.uid());

    -- run_steps
    DROP POLICY IF EXISTS run_steps_select_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_insert_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_update_own ON public.run_steps;
    DROP POLICY IF EXISTS run_steps_delete_own ON public.run_steps;
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
    CREATE POLICY run_steps_delete_own ON public.run_steps
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_steps.run_id AND r.user_id = auth.uid())
      );

    -- run_artifacts
    DROP POLICY IF EXISTS run_artifacts_select_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_insert_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_update_own ON public.run_artifacts;
    DROP POLICY IF EXISTS run_artifacts_delete_own ON public.run_artifacts;
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
    CREATE POLICY run_artifacts_delete_own ON public.run_artifacts
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = run_artifacts.run_id AND r.user_id = auth.uid())
      );

    -- trades
    DROP POLICY IF EXISTS trades_select_own ON public.trades;
    DROP POLICY IF EXISTS trades_insert_own ON public.trades;
    DROP POLICY IF EXISTS trades_update_own ON public.trades;
    DROP POLICY IF EXISTS trades_delete_own ON public.trades;
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
    CREATE POLICY trades_delete_own ON public.trades
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM public.runs r WHERE r.id = trades.run_id AND r.user_id = auth.uid())
      );
    """
  )
