-- Room Memory Phase 2: authentication and per-customer device ownership.
-- Apply with: docker exec -i roommemory-postgres-1 psql -U roommemory -d roommemory < database/002_auth_and_ownership.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS devices_owner_user_id_idx ON devices(owner_user_id);
