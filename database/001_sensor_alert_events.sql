CREATE TABLE IF NOT EXISTS sensor_alert_events (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL
        REFERENCES devices(id) ON DELETE CASCADE,
    alert_key TEXT NOT NULL,
    title TEXT NOT NULL,
    sensor TEXT NOT NULL,
    measured_value DOUBLE PRECISION,
    threshold_value DOUBLE PRECISION,
    severity TEXT NOT NULL
        CHECK (severity IN ('warning', 'critical')),
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'resolved')),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS
    sensor_alert_one_active_per_condition
ON sensor_alert_events (device_id, alert_key)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS
    sensor_alert_events_device_opened_idx
ON sensor_alert_events (device_id, opened_at DESC);

CREATE INDEX IF NOT EXISTS
    sensor_alert_events_status_severity_idx
ON sensor_alert_events (status, severity, opened_at DESC);