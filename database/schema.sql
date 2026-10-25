CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','company_admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  owner_user_id UUID REFERENCES app_users(id),
  firmware_version TEXT,
  hardware_model TEXT NOT NULL DEFAULT 'ESP32-ST7789',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS readings (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dht_temperature_c REAL,
  humidity_pct REAL,
  bmp_temperature_c REAL,
  pressure_hpa REAL,
  altitude_m REAL,
  ldr_do SMALLINT,
  rain_raw INTEGER,
  rain_wetness_pct SMALLINT,
  sensor_health JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS readings_device_time_idx ON readings(device_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  message TEXT NOT NULL,
  value NUMERIC,
  threshold NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS firmware_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL,
  artifact_url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  hardware_model TEXT NOT NULL,
  rollout_state TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID REFERENCES app_users(id),
  status TEXT NOT NULL DEFAULT 'queued',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES app_users(id),
  device_id UUID REFERENCES devices(id),
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
