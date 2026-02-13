-- Provision a least-privilege login role for the backend application.
-- Run this as a privileged role (for example, postgres) in Supabase SQL editor.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vibe_backend_login') THEN
    CREATE ROLE vibe_backend_login LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
  END IF;
END $$;

GRANT vibe_backend TO vibe_backend_login;

-- Optional hardening:
-- ALTER ROLE vibe_backend_login NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
