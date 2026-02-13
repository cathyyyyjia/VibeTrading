from __future__ import annotations

from alembic import op


revision = "0003_align_user_ids_and_realtime"
down_revision = "0002_add_rls_policies"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.execute(
    """
    DO $$
    DECLARE
      m RECORD;
    BEGIN
      -- Align legacy user IDs with Supabase auth UID (JWT sub) when sub is a UUID.
      FOR m IN
        SELECT DISTINCT
          oi.user_id AS old_user_id,
          (oi.subject)::uuid AS target_user_id
        FROM public.oauth_identities oi
        WHERE
          oi.subject ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND oi.user_id <> (oi.subject)::uuid
      LOOP
        INSERT INTO public.users (id, email, name, created_at, updated_at, last_signed_in_at)
        SELECT u.id, u.email, u.name, u.created_at, u.updated_at, u.last_signed_in_at
        FROM (
          SELECT
            m.target_user_id AS id,
            u0.email,
            u0.name,
            u0.created_at,
            u0.updated_at,
            u0.last_signed_in_at
          FROM public.users u0
          WHERE u0.id = m.old_user_id
        ) u
        ON CONFLICT (id) DO NOTHING;

        UPDATE public.users target
        SET
          email = COALESCE(target.email, source.email),
          name = COALESCE(target.name, source.name),
          last_signed_in_at = CASE
            WHEN target.last_signed_in_at IS NULL THEN source.last_signed_in_at
            WHEN source.last_signed_in_at IS NULL THEN target.last_signed_in_at
            ELSE GREATEST(target.last_signed_in_at, source.last_signed_in_at)
          END,
          updated_at = GREATEST(target.updated_at, source.updated_at)
        FROM public.users source
        WHERE target.id = m.target_user_id
          AND source.id = m.old_user_id;

        UPDATE public.strategies SET user_id = m.target_user_id WHERE user_id = m.old_user_id;
        UPDATE public.runs SET user_id = m.target_user_id WHERE user_id = m.old_user_id;

        DELETE FROM public.oauth_identities old_oi
        USING public.oauth_identities new_oi
        WHERE
          old_oi.user_id = m.old_user_id
          AND new_oi.user_id = m.target_user_id
          AND old_oi.provider = new_oi.provider
          AND old_oi.subject = new_oi.subject
          AND old_oi.id <> new_oi.id;

        UPDATE public.oauth_identities
        SET user_id = m.target_user_id
        WHERE user_id = m.old_user_id;

        IF m.old_user_id <> m.target_user_id
          AND NOT EXISTS (SELECT 1 FROM public.oauth_identities oi WHERE oi.user_id = m.old_user_id)
          AND NOT EXISTS (SELECT 1 FROM public.strategies s WHERE s.user_id = m.old_user_id)
          AND NOT EXISTS (SELECT 1 FROM public.runs r WHERE r.user_id = m.old_user_id)
        THEN
          DELETE FROM public.users u WHERE u.id = m.old_user_id;
        END IF;
      END LOOP;
    END $$;
    """
  )

  op.execute(
    """
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_publication p ON p.oid = pr.prpubid
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'runs'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_publication p ON p.oid = pr.prpubid
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'run_steps'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.run_steps;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_publication p ON p.oid = pr.prpubid
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'run_artifacts'
        ) THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE public.run_artifacts;
        END IF;
      END IF;
    END $$;
    """
  )


def downgrade() -> None:
  op.execute(
    """
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_publication p ON p.oid = pr.prpubid
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'run_artifacts'
        ) THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE public.run_artifacts;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_publication p ON p.oid = pr.prpubid
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'run_steps'
        ) THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE public.run_steps;
        END IF;

        IF EXISTS (
          SELECT 1
          FROM pg_publication_rel pr
          JOIN pg_publication p ON p.oid = pr.prpubid
          JOIN pg_class c ON c.oid = pr.prrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE p.pubname = 'supabase_realtime' AND n.nspname = 'public' AND c.relname = 'runs'
        ) THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE public.runs;
        END IF;
      END IF;
    END $$;
    """
  )
