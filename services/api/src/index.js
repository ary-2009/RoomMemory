import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import mqtt from 'mqtt';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const port = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.JWT_TTL || '12h';
const mqttUrl = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const legacyTelemetryTopic = 'room-memory/+/telemetry';
const versionedTelemetryTopic = 'roommemory/v1/devices/+/telemetry';

app.use(cors({
  origin: process.env.WEB_ORIGIN || 'http://localhost:5173'
}));
app.use(express.json({ limit: '1mb' }));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('error', (error) => {
  console.error('PostgreSQL pool error:', error.message);
});


// Optional email notifications. Configure SMTP_* and ALERT_EMAIL_TO in services/api/.env.
const smtpConfigured = Boolean(
  process.env.SMTP_HOST &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.ALERT_EMAIL_TO
);

const mailer = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

async function sendAlertEmail(deviceKey, alert) {
  if (!mailer) {
    console.info('Alert email skipped: SMTP is not configured.');
    return;
  }

  const subject = `[Room Memory] ${alert.severity.toUpperCase()}: ${alert.title}`;
  const text = [
    'Room Memory sensor alert',
    '',
    `Device: ${deviceKey}`,
    `Alert: ${alert.title}`,
    `Severity: ${alert.severity}`,
    `Sensor: ${alert.sensor}`,
    `Current value: ${alert.measuredValue}`,
    `Threshold: ${alert.thresholdValue}`,
    `Details: ${alert.message}`,
    '',
    'This email is sent once when a new alert event opens. Repeated readings do not send duplicate emails.'
  ].join('\n');

  await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.ALERT_EMAIL_TO,
    subject,
    text
  });
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDateQuery(value, name, res) {
  if (value === undefined || value === '') {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    res.status(400).json({ error: `Invalid "${name}" date. Use an ISO date/time.` });
    return undefined;
  }

  return date.toISOString();
}

// Authentication: signed bearer tokens and server-side role checks.
function issueToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, name: user.display_name }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const claims = jwt.verify(token, JWT_SECRET);
    req.user = { id: claims.sub, role: claims.role, email: claims.email, display_name: claims.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
  next();
}
async function canAccessDevice(user, deviceKey) {
  const result = await pool.query('SELECT id, owner_user_id FROM devices WHERE device_key = $1', [deviceKey]);
  if (!result.rowCount) return { exists: false, allowed: false };
  const row = result.rows[0];
  return { exists: true, allowed: user.role === 'admin' || row.owner_user_id === user.id, deviceId: row.id };
}

// First-run setup is permitted only when no admin exists and the secret matches .env.
app.post('/api/auth/bootstrap', async (req, res) => {
  const secret = process.env.BOOTSTRAP_SECRET;
  if (!secret) return res.status(404).json({ error: 'First-run setup is disabled. Configure BOOTSTRAP_SECRET in the API .env first.' });
  const count = await pool.query("SELECT COUNT(*)::int AS count FROM auth_users WHERE role = 'admin'");
  if (count.rows[0].count > 0) return res.status(409).json({ error: 'An administrator already exists. Use the login screen.' });
  const { bootstrapSecret, email, password, displayName } = req.body || {};
  if (bootstrapSecret !== secret) return res.status(403).json({ error: 'Incorrect setup secret' });
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'Provide a valid email and password of at least 12 characters.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(`INSERT INTO auth_users(email, display_name, password_hash, role)
      VALUES($1,$2,$3,'admin') RETURNING id,email,display_name,role`,
      [email.toLowerCase().trim(), String(displayName || 'Room Memory Admin').trim().slice(0,100), passwordHash]);
    const user = result.rows[0];
    return res.status(201).json({ token: issueToken(user), user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    console.error('Admin bootstrap failed:', error.message);
    return res.status(500).json({ error: 'Could not create the administrator.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const result = await pool.query('SELECT id,email,display_name,password_hash,role FROM auth_users WHERE email = $1', [email.toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    const publicUser = { id: user.id, email: user.email, display_name: user.display_name, role: user.role };
    res.json({ token: issueToken(publicUser), user: publicUser });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Login failed. Confirm the auth database migration was applied.' });
  }
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT u.id,u.email,u.display_name,u.role,u.created_at,
      COUNT(d.id)::int AS device_count FROM auth_users u LEFT JOIN devices d ON d.owner_user_id=u.id
      GROUP BY u.id ORDER BY u.created_at DESC`);
    res.json(result.rows);
  } catch (error) { console.error('User list failed:', error.message); res.status(500).json({ error: 'Could not load users' }); }
});
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'Provide a valid email and a password of at least 12 characters.' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(`INSERT INTO auth_users(email,display_name,password_hash,role)
      VALUES($1,$2,$3,'user') RETURNING id,email,display_name,role,created_at`,
      [email.toLowerCase().trim(), String(displayName || 'Room Memory Customer').trim().slice(0,100), hash]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That email is already registered.' });
    console.error('User creation failed:', error.message); res.status(500).json({ error: 'Could not create user' });
  }
});
app.post('/api/admin/devices/:deviceKey/owner', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body || {};
  try {
    if (userId) {
      const user = await pool.query("SELECT id FROM auth_users WHERE id=$1 AND role='user'", [userId]);
      if (!user.rowCount) return res.status(400).json({ error: 'Choose a valid customer account.' });
    }
    const result = await pool.query('UPDATE devices SET owner_user_id=$2 WHERE device_key=$1 RETURNING device_key,name,owner_user_id', [req.params.deviceKey, userId || null]);
    if (!result.rowCount) return res.status(404).json({ error: 'Device not found' });
    res.json(result.rows[0]);
  } catch (error) { console.error('Device assignment failed:', error.message); res.status(500).json({ error: 'Could not assign device' }); }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'room-memory-api',
    mode: 'mqtt-enabled'
  });
});

// Demo endpoint
app.get('/api/demo/devices', (_req, res) => {
  res.json([
    {
      id: 'RM-001',
      name: 'Room Memory — Demo',
      status: 'online',
      firmware: '0.1.0',
      temperature: 28.4,
      humidity: 61,
      pressure: 1001.8,
      rainWetness: 8,
      ldr: 'HIGH'
    }
  ]);
});

// List registered devices
app.get('/api/devices', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, device_key, name, status, owner_user_id,
             firmware_version, last_seen_at
      FROM devices
      WHERE ($1::text = 'admin' OR owner_user_id = $2::uuid)
      ORDER BY created_at DESC
      LIMIT 100
    `, [req.user.role, req.user.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Device query failed:', error.message);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Read telemetry history for one device.
// Optional query parameters:
//   limit=2000
//   from=2026-10-01T00:00:00.000Z
//   to=2026-10-24T23:59:59.999Z
app.get('/api/telemetry/:deviceKey', requireAuth, async (req, res) => {
  try {
    const access = await canAccessDevice(req.user, req.params.deviceKey);
    if (!access.exists) return res.status(404).json({ error: 'Device not found' });
    if (!access.allowed) return res.status(403).json({ error: 'You do not have access to this device' });
    const rawLimit = req.query.limit;
    let limit = 50;

    if (rawLimit !== undefined) {
      const parsedLimit = Number(rawLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 10000) {
        return res.status(400).json({
          error: 'Invalid "limit". Provide an integer from 1 to 10000.'
        });
      }
      limit = parsedLimit;
    }

    const from = parseDateQuery(req.query.from, 'from', res);
    if (from === undefined) return;

    const to = parseDateQuery(req.query.to, 'to', res);
    if (to === undefined) return;

    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({
        error: '"from" must be earlier than or equal to "to".'
      });
    }

    const values = [req.params.deviceKey];
    let dateConditions = '';

    if (from) {
      values.push(from);
      dateConditions += ` AND t.recorded_at >= $${values.length}`;
    }

    if (to) {
      values.push(to);
      dateConditions += ` AND t.recorded_at <= $${values.length}`;
    }

    values.push(limit);

    const result = await pool.query(`
      SELECT t.id, d.device_key, t.temperature,
             t.pressure, t.humidity, t.rain_wetness,
             t.ldr, t.payload, t.recorded_at
      FROM device_telemetry t
      JOIN devices d ON d.id = t.device_id
      WHERE d.device_key = $1
      ${dateConditions}
      ORDER BY t.recorded_at DESC
      LIMIT $${values.length}
    `, values);

    res.json(result.rows);
  } catch (error) {
    console.error('Telemetry query failed:', error.message);
    res.status(500).json({ error: 'Telemetry query failed' });
  }
});


// Persist alert state transitions. Apply database/001_sensor_alert_events.sql before using these endpoints.
function finiteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSensorAlerts(latest, thresholds) {
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)) return [];
  const payload = latest.payload && typeof latest.payload === 'object' ? latest.payload : {};
  const read = (...values) => {
    for (const value of values) {
      const n = finiteNumber(value);
      if (n !== null) return n;
    }
    return null;
  };
  const temperature = read(latest.temperature, payload.dhtTemp, payload.dhtTemperature, payload.temperature);
  const humidity = read(latest.humidity, payload.humidity);
  const pressure = read(latest.pressure, payload.pressure);
  const rain = read(latest.rain_wetness, latest.rainWetness, payload.rain_wetness, payload.rainWetness, payload.rainWetnessPercent);
  const t = thresholds || {};
  const defaults = { temperatureMin: 10, temperatureMax: 35, humidityMin: 20, humidityMax: 80, pressureMin: 950, pressureMax: 1050, rainMax: 50 };
  const limit = key => finiteNumber(t[key]) ?? defaults[key];
  const alerts = [];
  if (temperature !== null && temperature < limit('temperatureMin')) alerts.push({ alertKey: 'temperature-low', title: 'Temperature below range', sensor: 'temperature', measuredValue: temperature, thresholdValue: limit('temperatureMin'), severity: 'warning', message: `${temperature} °C is below ${limit('temperatureMin')} °C.` });
  if (temperature !== null && temperature > limit('temperatureMax')) alerts.push({ alertKey: 'temperature-high', title: 'Temperature above range', sensor: 'temperature', measuredValue: temperature, thresholdValue: limit('temperatureMax'), severity: 'critical', message: `${temperature} °C is above ${limit('temperatureMax')} °C.` });
  if (humidity !== null && humidity < limit('humidityMin')) alerts.push({ alertKey: 'humidity-low', title: 'Humidity below range', sensor: 'humidity', measuredValue: humidity, thresholdValue: limit('humidityMin'), severity: 'warning', message: `${humidity}% is below ${limit('humidityMin')}%.` });
  if (humidity !== null && humidity > limit('humidityMax')) alerts.push({ alertKey: 'humidity-high', title: 'Humidity above range', sensor: 'humidity', measuredValue: humidity, thresholdValue: limit('humidityMax'), severity: 'warning', message: `${humidity}% is above ${limit('humidityMax')}%.` });
  if (pressure !== null && pressure < limit('pressureMin')) alerts.push({ alertKey: 'pressure-low', title: 'Pressure below range', sensor: 'pressure', measuredValue: pressure, thresholdValue: limit('pressureMin'), severity: 'warning', message: `${pressure} hPa is below ${limit('pressureMin')} hPa.` });
  if (pressure !== null && pressure > limit('pressureMax')) alerts.push({ alertKey: 'pressure-high', title: 'Pressure above range', sensor: 'pressure', measuredValue: pressure, thresholdValue: limit('pressureMax'), severity: 'warning', message: `${pressure} hPa is above ${limit('pressureMax')} hPa.` });
  if (rain !== null && rain >= limit('rainMax')) alerts.push({ alertKey: 'rain-high', title: 'Rain wetness threshold reached', sensor: 'rain_wetness', measuredValue: rain, thresholdValue: limit('rainMax'), severity: 'critical', message: `Rain wetness is ${rain}%, at or above ${limit('rainMax')}%.` });
  return alerts;
}

app.post('/api/alerts/evaluate', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { deviceKey: accessKey } = req.body || {};
    const access = await canAccessDevice(req.user, accessKey);
    if (!access.exists) return res.status(404).json({ error: 'Device not found' });
    if (!access.allowed) return res.status(403).json({ error: 'You do not have access to this device' });
    const { deviceKey, latest, thresholds } = req.body || {};
    if (typeof deviceKey !== 'string' || !deviceKey.trim()) {
      return res.status(400).json({ error: 'deviceKey is required' });
    }
    const deviceResult = await client.query('SELECT id FROM devices WHERE device_key = $1', [deviceKey]);
    if (!deviceResult.rowCount) return res.status(404).json({ error: 'Unknown device' });
    const deviceId = deviceResult.rows[0].id;
    const active = buildSensorAlerts(latest, thresholds);
    const activeKeys = active.map(a => a.alertKey);

    await client.query('BEGIN');
    const newlyOpenedAlerts = [];

    for (const alert of active) {
      const params = [
        deviceId, alert.alertKey, alert.title, alert.sensor,
        alert.measuredValue, alert.thresholdValue, alert.severity, alert.message
      ];
      const inserted = await client.query(`
        INSERT INTO sensor_alert_events (
          device_id, alert_key, title, sensor, measured_value,
          threshold_value, severity, message, status, opened_at, last_seen_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',NOW(),NOW())
        ON CONFLICT (device_id, alert_key) WHERE status = 'active'
        DO NOTHING
        RETURNING id
      `, params);

      if (inserted.rowCount > 0) {
        newlyOpenedAlerts.push(alert);
      } else {
        await client.query(`
          UPDATE sensor_alert_events
          SET measured_value = $3,
              threshold_value = $4,
              severity = $5,
              message = $6,
              last_seen_at = NOW()
          WHERE device_id = $1 AND alert_key = $2 AND status = 'active'
        `, [
          deviceId, alert.alertKey, alert.measuredValue,
          alert.thresholdValue, alert.severity, alert.message
        ]);
      }
    }

    await client.query(`
      UPDATE sensor_alert_events
      SET status = 'resolved', resolved_at = NOW()
      WHERE device_id = $1 AND status = 'active'
        AND NOT (alert_key = ANY($2::text[]))
    `, [deviceId, activeKeys]);
    await client.query('COMMIT');

    // Email only after the database transaction commits; mail failure won't roll back saved events.
    for (const alert of newlyOpenedAlerts) {
      try {
        await sendAlertEmail(deviceKey, alert);
      } catch (mailError) {
        console.error(`Alert email failed for ${deviceKey}/${alert.alertKey}:`, mailError.message);
      }
    }

    res.json({
      ok: true,
      deviceKey,
      activeCount: active.length,
      newlyOpenedCount: newlyOpenedAlerts.length,
      emailConfigured: Boolean(mailer)
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Alert evaluation failed:', error.message);
    res.status(500).json({ error: 'Alert evaluation failed' });
  } finally {
    client.release();
  }
});

// Retrieve saved alert history for a device.
app.get('/api/alerts/:deviceKey', requireAuth, async (req, res) => {
  try {
    const access = await canAccessDevice(req.user, req.params.deviceKey);
    if (!access.exists) return res.status(404).json({ error: 'Device not found' });
    if (!access.allowed) return res.status(403).json({ error: 'You do not have access to this device' });
    const rawLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 500) {
      return res.status(400).json({ error: 'limit must be an integer from 1 to 500' });
    }
    const { status, severity, from, to } = req.query;
    if (status && !['active', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'status must be active or resolved' });
    }
    if (severity && !['warning', 'critical'].includes(severity)) {
      return res.status(400).json({ error: 'severity must be warning or critical' });
    }
    const values = [req.params.deviceKey];
    let filters = '';
    if (status) { values.push(status); filters += ` AND a.status = $${values.length}`; }
    if (severity) { values.push(severity); filters += ` AND a.severity = $${values.length}`; }
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid from date' });
      values.push(d.toISOString()); filters += ` AND a.opened_at >= $${values.length}`;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid to date' });
      values.push(d.toISOString()); filters += ` AND a.opened_at <= $${values.length}`;
    }
    values.push(rawLimit);
    const result = await pool.query(`
      SELECT a.id, d.device_key, a.alert_key, a.title, a.sensor,
             a.measured_value, a.threshold_value, a.severity, a.message,
             a.status, a.opened_at, a.last_seen_at, a.resolved_at
      FROM sensor_alert_events a
      JOIN devices d ON d.id = a.device_id
      WHERE d.device_key = $1 ${filters}
      ORDER BY a.opened_at DESC
      LIMIT $${values.length}
    `, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Alert history query failed:', error.message);
    res.status(500).json({ error: 'Alert history query failed' });
  }
});

// MQTT connection
const mqttClient = mqtt.connect(mqttUrl, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  reconnectPeriod: 3000,
  connectTimeout: 10000,
  rejectUnauthorized: true
});

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker:', mqttUrl);

  for (const topicFilter of [legacyTelemetryTopic, versionedTelemetryTopic]) {
    mqttClient.subscribe(topicFilter, { qos: 0 }, (error) => {
      if (error) {
        console.error(`MQTT subscription failed for ${topicFilter}:`, error.message);
      } else {
        console.log('Subscribed to:', topicFilter);
      }
    });
  }
});

mqttClient.on('reconnect', () => {
  console.log('Reconnecting to MQTT broker...');
});

mqttClient.on('error', (error) => {
  console.error('MQTT error:', error.message);
});

mqttClient.on('message', async (topic, message) => {
  try {
    const parts = topic.split('/');
    let deviceKey = null;

    // Support the original local topic and the versioned product topic.
    if (parts.length === 3 && parts[0] === 'room-memory' && parts[2] === 'telemetry') {
      deviceKey = parts[1];
    } else if (
      parts.length === 5 &&
      parts[0] === 'roommemory' &&
      parts[1] === 'v1' &&
      parts[2] === 'devices' &&
      parts[4] === 'telemetry'
    ) {
      deviceKey = parts[3];
    }
    if (!deviceKey) return;

    const data = JSON.parse(message.toString());

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Telemetry must be a JSON object');
    }

    // Match the topic's device key to a registered device.
    const deviceResult = await pool.query(`
      UPDATE devices
      SET status = 'online', last_seen_at = NOW()
      WHERE device_key = $1
      RETURNING id
    `, [deviceKey]);

    if (deviceResult.rowCount === 0) {
      console.warn('Ignoring telemetry from unknown device:', deviceKey);
      return;
    }

    const deviceId = deviceResult.rows[0].id;

    await pool.query(`
      INSERT INTO device_telemetry (
        device_id, temperature, pressure, humidity,
        rain_wetness, ldr, payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `, [
      deviceId,
      // Canonical temperature column represents DHT11 room temperature.
      numberOrNull(data.dhtTemp ?? data.dhtTemperature ?? data.temperature),
      numberOrNull(data.pressureHpa ?? data.pressure),
      numberOrNull(data.humidity),
      numberOrNull(data.rainWetnessPct ?? data.rainWetness ?? data.rain_wetness ?? data.rain_wetness_pct),
      (data.ldr ?? data.ldrDO) == null ? null : String(data.ldr ?? data.ldrDO),
      JSON.stringify(data)
    ]);

    console.log(`Telemetry saved for ${deviceKey}:`, data);
  } catch (error) {
    console.error('Telemetry processing failed:', error.message);
  }
});

const server = app.listen(port, () => {
  console.log(`Room Memory API listening on :${port}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Room Memory API could not start: port ${port} is already in use.`);
    console.error(`The API may already be running. Stop the process using port ${port} or use that existing instance.`);
  } else {
    console.error('Room Memory API failed to start:', error.message);
  }
  process.exitCode = 1;
});

async function shutdown() {
  console.log('Shutting down Room Memory API...');
  mqttClient.end(true);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
