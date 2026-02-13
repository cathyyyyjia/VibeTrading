from __future__ import annotations

from alembic import op


revision = "0006_users_fk_to_auth_users"
down_revision = "0005_rls_hardening_and_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
  op.execute(
    """
    -- Keep only profile rows that still have a matching auth user.
    DELETE FROM public.users u
    WHERE NOT EXISTS (
      SELECT 1 FROM auth.users au WHERE au.id = u.id
    );
    """
  )

  op.execute(
    """
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_id_fkey_auth_users'
          AND conrelid = 'public.users'::regclass
      ) THEN
        ALTER TABLE public.users
          ADD CONSTRAINT users_id_fkey_auth_users
          FOREIGN KEY (id)
          REFERENCES auth.users(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
    """
  )


def downgrade() -> None:
  op.execute(
    """
    ALTER TABLE public.users
      DROP CONSTRAINT IF EXISTS users_id_fkey_auth_users;
    """
  )
