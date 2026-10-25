import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./navigation-patch.css";
import Analytics from "./Analytics";
import Alerts, { DEFAULT_THRESHOLDS, type AlertThresholds } from "./Alerts";
import Login from "./Login";
import AdminPanel from "./AdminPanel";
import { apiFetch, clearSession, readAuthUser, type AuthUser } from "./auth";
import "./auth.css";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? "";
const REFRESH_MS = 5000;
const ALERTS_STORAGE_KEY = "room-memory-alert-thresholds";

function readSavedThresholds(): AlertThresholds {
  try {
    const raw = window.localStorage.getItem(ALERTS_STORAGE_KEY);
    if (!raw) return DEFAULT_THRESHOLDS;
    const parsed = JSON.parse(raw) as Partial<AlertThresholds>;
    return { ...DEFAULT_THRESHOLDS, ...parsed };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

function getActiveAlerts(row: Telemetry | undefined, thresholds: AlertThresholds) {
  if (!row) return [];
  const value = (direct: unknown, payloadKey?: string) => {
    const n = numberValue(direct);
    return n !== null ? n : payloadKey ? numberValue(row.payload?.[payloadKey]) : null;
  };
  const temperature = value(row.temperature, "dhtTemp") ?? value(row.payload?.dhtTemperature, "temperature");
  const humidity = value(row.humidity, "humidity");
  const pressure = value(row.pressure, "pressure");
  const rain = value(row.rain_wetness, "rainWetness") ?? value(row.payload?.rain_wetness, "rainWetness");
  const alerts: { key: string; title: string; message: string; severity: "warning" | "critical" }[] = [];
  if (temperature !== null && temperature < thresholds.temperatureMin) alerts.push({ key: "temperature-low", title: "Low temperature", message: `${temperature.toFixed(1)} °C is below ${thresholds.temperatureMin} °C.`, severity: "warning" });
  if (temperature !== null && temperature > thresholds.temperatureMax) alerts.push({ key: "temperature-high", title: "High temperature", message: `${temperature.toFixed(1)} °C is above ${thresholds.temperatureMax} °C.`, severity: "critical" });
  if (humidity !== null && humidity < thresholds.humidityMin) alerts.push({ key: "humidity-low", title: "Low humidity", message: `${humidity.toFixed(0)}% is below ${thresholds.humidityMin}%.`, severity: "warning" });
  if (humidity !== null && humidity > thresholds.humidityMax) alerts.push({ key: "humidity-high", title: "High humidity", message: `${humidity.toFixed(0)}% is above ${thresholds.humidityMax}%.`, severity: "warning" });
  if (pressure !== null && pressure < thresholds.pressureMin) alerts.push({ key: "pressure-low", title: "Low pressure", message: `${pressure.toFixed(1)} hPa is below ${thresholds.pressureMin} hPa.`, severity: "warning" });
  if (pressure !== null && pressure > thresholds.pressureMax) alerts.push({ key: "pressure-high", title: "High pressure", message: `${pressure.toFixed(1)} hPa is above ${thresholds.pressureMax} hPa.`, severity: "warning" });
  if (rain !== null && rain >= thresholds.rainMax) alerts.push({ key: "rain-high", title: "Rain detected", message: `Rain wetness is ${rain.toFixed(0)}%, at or above the ${thresholds.rainMax}% threshold.`, severity: "critical" });
  return alerts;
}

type Device = {
  id: string;
  device_key: string;
  name: string;
  status: string;
  firmware_version?: string;
  last_seen_at?: string | null;
};

type Telemetry = {
  id: string | number;
  device_key?: string;
  temperature?: number | null;
  pressure?: number | null;
  humidity?: number | null;
  rain_wetness?: number | null;
  ldr?: string | null;
  payload?: Record<string, any> | null;
  recorded_at: string;
};

function formatTime(value?: string | null) {
  if (!value) return "No readings yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });
}
function ageLabel(value?: string | null) {
  if (!value) return "Never connected";
  const age = Math.max(0, Date.now() - new Date(value).getTime());
  if (!Number.isFinite(age)) return "Unknown";
  if (age < 60_000) return "Just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} min ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} hr ago`;
  return `${Math.floor(age / 86_400_000)} days ago`;
}
function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function latestValue(row: Telemetry | undefined, field: keyof Telemetry, payloadField?: string) {
  if (!row) return null;
  const direct = numberValue(row[field]);
  if (direct !== null) return direct;
  return payloadField ? numberValue(row.payload?.[payloadField]) : null;
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    temperature: <><path d="M14 14.76V5a4 4 0 0 0-8 0v9.76a6 6 0 1 0 8 0Z"/><path d="M10 11v7"/></>,
    pressure: <><circle cx="12" cy="12" r="9"/><path d="m12 12 4-4"/><path d="M7 16h10"/></>,
    humidity: <><path d="M12 3.5S5 11 5 15a7 7 0 0 0 14 0c0-4-7-11.5-7-11.5Z"/><path d="M9 16a3 3 0 0 0 3 3"/></>,
    rain: <><path d="M20 15.5a4.5 4.5 0 0 0-1.2-8.84A6 6 0 0 0 7.3 8.4 3.8 3.8 0 0 0 8 16h12"/><path d="m8 19-1 2m7-2-1 2m7-2-1 2"/></>,
    light: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    wifi: <><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M12 20h.01"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 17 6l3 6M4 12l3 6a7 7 0 0 0 11.4-3"/></>,
    device: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6M9 17h6"/></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.device}</svg>;
}

function MetricCard({ title, value, unit, subtitle, icon, tone }: {
  title: string; value: string; unit?: string; subtitle: string; icon: string; tone: string;
}) {
  return <article className={`metric-card ${tone}`}>
    <div className="metric-top"><span className="metric-label">{title}</span><span className="metric-icon"><Icon name={icon}/></span></div>
    <div className="metric-value">{value}<span>{unit}</span></div>
    <div className="metric-subtitle">{subtitle}</div>
  </article>;
}

function TrendChart({ rows }: { rows: Telemetry[] }) {
  const points = useMemo(() => [...rows].reverse().map(r => ({
    time: new Date(r.recorded_at).getTime(),
    temp: numberValue(r.temperature) ?? numberValue(r.payload?.dhtTemp) ?? numberValue(r.payload?.dhtTemperature),
    humidity: numberValue(r.humidity),
  })).filter(p => Number.isFinite(p.time)), [rows]);
  const values = points.filter(p => p.temp !== null);
  const width = 720, height = 220, padX = 18, padY = 22;
  const min = values.length ? Math.min(...values.map(p => p.temp as number)) - 1 : 0;
  const max = values.length ? Math.max(...values.map(p => p.temp as number)) + 1 : 40;
  const span = Math.max(1, max - min);
  const coords = values.map((p, i) => ({
    x: padX + (values.length <= 1 ? 0 : i * (width - padX * 2) / (values.length - 1)),
    y: height - padY - (((p.temp as number) - min) / span) * (height - padY * 2),
    value: p.temp as number,
    time: p.time
  }));
  const line = coords.map(p => `${p.x},${p.y}`).join(" ");
  const area = coords.length ? `${coords[0].x},${height-padY} ${line} ${coords[coords.length-1].x},${height-padY}` : "";
  return <div className="chart-card">
    <div className="section-heading">
      <div><div className="eyebrow">ENVIRONMENT</div><h2>Temperature history</h2></div>
      <span className="chart-legend"><i/> Temperature · °C</span>
    </div>
    {coords.length < 2 ? <div className="chart-empty"><Icon name="temperature"/><span>Waiting for more readings to draw a trend.</span><small>Telemetry is refreshed every 5 seconds.</small></div> :
      <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Temperature history chart">
        {[0,1,2,3].map(i => { const y = padY + i*(height-padY*2)/3; return <g key={i}><line x1={padX} y1={y} x2={width-padX} y2={y} className="grid-line"/><text x={padX} y={y-6} className="axis-label">{(max - i*span/3).toFixed(1)}°</text></g>; })}
        <polygon points={area} className="chart-area"/>
        <polyline points={line} className="chart-line"/>
        {coords.map((p,i) => <circle key={i} cx={p.x} cy={p.y} r="3.5" className="chart-dot"><title>{`${p.value.toFixed(1)} °C — ${new Date(p.time).toLocaleTimeString()}`}</title></circle>)}
      </svg><div className="chart-footer"><span>{new Date(points[0].time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span><span>{new Date(points[points.length-1].time).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span></div></div>
    }
    <div className="chart-note">Showing up to 50 most recent records from the API.</div>
  </div>;
}

function Dashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [page, setPage] = useState<"overview" | "analytics" | "alerts" | "admin">("overview");
  const [thresholds, setThresholds] = useState<AlertThresholds>(() => readSavedThresholds());
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedKey, setSelectedKey] = useState("RM-001");
  const [rows, setRows] = useState<Telemetry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setRefreshing(true);
    try {
      const deviceResponse = await apiFetch(`${API_BASE}/api/devices`, { cache: "no-store" });
      if (!deviceResponse.ok) throw new Error(`Devices API returned HTTP ${deviceResponse.status}`);
      const deviceData = await deviceResponse.json();
      if (!Array.isArray(deviceData)) throw new Error("Unexpected devices API response.");
      setDevices(deviceData);
      const resolvedKey = deviceData.some((d: Device) => d.device_key === selectedKey) ? selectedKey : deviceData[0]?.device_key;
      if (resolvedKey && resolvedKey !== selectedKey) setSelectedKey(resolvedKey);
      if (!resolvedKey) { setRows([]); setError(""); setLastUpdated(new Date()); return; }
      const telemetryResponse = await apiFetch(`${API_BASE}/api/telemetry/${encodeURIComponent(resolvedKey)}`, { cache: "no-store" });
      if (!telemetryResponse.ok) throw new Error(`Telemetry API returned HTTP ${telemetryResponse.status}`);
      const telemetryData = await telemetryResponse.json();
      if (!Array.isArray(telemetryData)) throw new Error("Unexpected telemetry API response.");
      setRows(telemetryData);
      setError("");
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect to Room Memory API.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const device = devices.find(d => d.device_key === selectedKey);
  const latest = rows[0];

  // Persist alert state transitions in PostgreSQL whenever fresh telemetry or thresholds arrive.
  useEffect(() => {
    if (!latest || !selectedKey) return;
    const controller = new AbortController();
    apiFetch(`${API_BASE}/api/alerts/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        deviceKey: selectedKey,
        latest,
        thresholds
      })
    }).catch(error => {
      if (error.name !== "AbortError") console.error("Alert evaluation request failed:", error);
    });
    return () => controller.abort();
  }, [latest?.id, latest?.recorded_at, selectedKey, thresholds]);
  const temp = latestValue(latest, "temperature");
  const humidity = latestValue(latest, "humidity");
  const pressure = latestValue(latest, "pressure");
  const rain = latestValue(latest, "rain_wetness", "rainWetness");
  const ldr = latest?.ldr ?? latest?.payload?.ldr ?? null;
  const dhtTemp = numberValue(latest?.payload?.dhtTemp) ?? numberValue(latest?.payload?.dhtTemperature) ?? temp;
  const isOnline = device?.status?.toLowerCase() === "online";
  const sensorTime = latest?.recorded_at || device?.last_seen_at;
  const rainLabel = rain === null ? "No data" : rain >= 50 ? "Wet conditions" : "Mostly dry";
  const activeAlerts = getActiveAlerts(latest, thresholds);
  const saveThresholds = useCallback((next: AlertThresholds) => {
    setThresholds(next);
    try { window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  }, []);
  const sensorCards = [
    {title:"Room temperature",value:dhtTemp === null ? "--" : dhtTemp.toFixed(1),unit:"°C",subtitle:dhtTemp === null ? "DHT11 reading unavailable" : "DHT11 room sensor",icon:"temperature",tone:"orange"},
    {title:"Humidity",value:humidity === null ? "--" : humidity.toFixed(0),unit:"%",subtitle:"Relative humidity · DHT11",icon:"humidity",tone:"blue"},
    {title:"Atmospheric pressure",value:pressure === null ? "--" : pressure.toFixed(1),unit:"hPa",subtitle:"BMP280 sensor",icon:"pressure",tone:"violet"},
    {title:"Rain wetness",value:rain === null ? "--" : rain.toFixed(0),unit:"%",subtitle:rainLabel,icon:"rain",tone:"cyan"},
  ];

  if (page === "analytics") return <><div className="auth-toolbar"><span>{user.display_name} · {user.role}</span><button onClick={onLogout}>Sign out</button></div><Analytics onBack={() => setPage("overview")} /></>;
  if (page === "admin" && user.role === "admin") return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark"><Icon name="device"/></div><div><strong>room<span>memory</span></strong><small>ADMIN CONSOLE</small></div></div><button type="button" className="nav-item nav-button" onClick={() => setPage("overview")}>← Back to overview</button><div className="sidebar-bottom"><div className="sidebar-status"><div><b>{user.display_name}</b><small>Administrator</small></div></div><button className="nav-item nav-button" onClick={onLogout}>Sign out</button></div></aside><main className="main-content"><AdminPanel /></main></div>;
  if (page === "alerts") return <Alerts
    onBack={() => setPage("overview")}
    deviceKey={selectedKey}
    latest={latest}
    thresholds={thresholds}
    onThresholdsChange={saveThresholds}
    lastUpdated={lastUpdated}
  />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="device"/></div><div><strong>room<span>memory</span></strong><small>ENVIRONMENT MONITORING</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button type="button" className={`nav-item nav-button ${page === "overview" ? "active" : ""}`} onClick={() => setPage("overview")}><span className="nav-dot"/> Overview</button>
       <button type="button" className={`nav-item nav-button ${page === "analytics" ? "active" : ""}`} onClick={() => setPage("analytics")}><Icon name="pressure"/> Sensor analytics</button>
      <button type="button" className={`nav-item nav-button ${page === "alerts" ? "active" : ""}`} onClick={() => setPage("alerts")}><span className="alerts-nav-icon">!</span> Sensor alerts {activeAlerts.length > 0 && <span className="alerts-count">{activeAlerts.length}</span>}</button>
      <div className="nav-item"><Icon name="device"/> {user.role === "admin" ? "All devices" : "My devices"}</div>
      {user.role === "admin" && <button type="button" className={`nav-item nav-button ${page === "admin" ? "active" : ""}`} onClick={() => setPage("admin")}><span className="nav-dot"/> Admin · customers</button>}
      <div className="sidebar-bottom"><div className="sidebar-status"><span className={`status-dot ${isOnline ? "online" : ""}`}/><div><b>{isOnline ? "Device online" : "Device offline"}</b><small>{selectedKey}</small></div></div><div className="sidebar-foot">Room Memory IoT Platform<br/>Local development workspace</div></div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumbs">Workspace <span>/</span> <b>Overview</b></div>
        <div className="topbar-right"><span className="live-pill"><i/> LIVE DATA</span><span className="avatar">{user.role === "admin" ? "AD" : "US"}</span><span className="auth-user-name">{user.display_name}</span><button className="signout-button" onClick={onLogout}>Sign out</button></div>
      </header>

      <section className="page-intro">
        <div><div className="eyebrow">YOUR ENVIRONMENT, AT A GLANCE</div><h1>Room overview</h1><p>Monitor room conditions and connected sensors in real time.</p></div>
        <div className="intro-actions">
          <label className="device-select-label">DEVICE
            <select value={selectedKey} onChange={e => setSelectedKey(e.target.value)}>
              {(devices.length ? devices : [{device_key:"RM-001", name:"Room Memory ESP32"} as Device]).map(d => <option key={d.device_key} value={d.device_key}>{d.name} · {d.device_key}</option>)}
            </select>
          </label>
          <button className="refresh-button" onClick={() => void refresh(false)} disabled={refreshing}><Icon name="refresh"/>{refreshing ? "Refreshing" : "Refresh"}</button>
        </div>
      </section>

      {error && <div className="error-banner"><strong>API connection issue</strong><span>{error}. Make sure the Node.js API is running on {API_BASE}.</span><button onClick={() => void refresh(false)}>Retry</button></div>}

      <section className="status-strip">
        <div className="device-identity"><div className="device-avatar"><Icon name="device"/></div><div><b>{device?.name || "Room Memory ESP32"}</b><small>{selectedKey} <span>·</span> Firmware {device?.firmware_version || "—"}</small></div></div>
        <div className="status-meta"><span className={`status-badge ${isOnline ? "is-online" : "is-offline"}`}><i/>{isOnline ? "Online" : "Offline"}</span><span className="last-seen"><Icon name="clock"/> Last seen {ageLabel(device?.last_seen_at)}</span><span className="updated-label">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Waiting for API"}</span></div>
      </section>

      {activeAlerts.length > 0 && <section className="overview-alert-banner" role="status">
        <div className="overview-alert-symbol">!</div>
        <div className="overview-alert-copy"><strong>{activeAlerts.length} active sensor {activeAlerts.length === 1 ? "alert" : "alerts"}</strong><span>{activeAlerts.slice(0, 2).map(a => a.title).join(" · ")}{activeAlerts.length > 2 ? ` · +${activeAlerts.length - 2} more` : ""}</span></div>
        <button type="button" onClick={() => setPage("alerts")}>Review alerts →</button>
      </section>}

      <section className="section-block">
        <div className="section-heading section-heading-main"><div><div className="eyebrow">LIVE TELEMETRY</div><h2>Sensor readings</h2></div><span className="update-frequency"><span className="pulse-dot"/> Auto-refresh every 5 seconds</span></div>
        <div className="metric-grid">{sensorCards.map(card => <MetricCard key={card.title} {...card}/>)}</div>
        <div className="secondary-grid">
          <article className="detail-card"><div className="detail-icon sun"><Icon name="light"/></div><div className="detail-copy"><span>Light sensor · LDR</span><strong>{ldr === null ? "No data" : String(ldr).toUpperCase()}</strong><small>Digital output</small></div><span className={`mini-tag ${String(ldr).toUpperCase()==="HIGH"?"tag-good":"tag-neutral"}`}>{ldr === null ? "Unknown" : String(ldr).toUpperCase()==="HIGH" ? "HIGH" : "LOW"}</span></article>
          <article className="detail-card"><div className="detail-icon rain"><Icon name="rain"/></div><div className="detail-copy"><span>Rain sensor · Analog</span><strong>{numberValue(latest?.payload?.rainRaw) === null ? "No raw value" : `${Math.round(numberValue(latest?.payload?.rainRaw) as number)} / 4095`}</strong><small>Estimated wetness: {rain === null ? "—" : `${rain.toFixed(0)}%`}</small></div><span className={`mini-tag ${rain !== null && rain >= 50 ? "tag-warn" : "tag-good"}`}>{rain === null ? "Unknown" : rain >= 50 ? "WET" : "DRY"}</span></article>
        </div>
      </section>

      <section className="bottom-grid">
        <TrendChart rows={rows}/>
        <article className="activity-card">
          <div className="section-heading"><div><div className="eyebrow">CONNECTION</div><h2>Device health</h2></div><div className={`health-icon ${isOnline?"healthy":""}`}><Icon name="wifi"/></div></div>
          <div className="health-row"><span>MQTT device status</span><b className={isOnline?"text-green":"text-muted"}><i className={`tiny-dot ${isOnline?"green":""}`}/>{isOnline?"Connected":"Not connected"}</b></div>
          <div className="health-row"><span>Last telemetry</span><b>{formatTime(sensorTime)}</b></div>
          <div className="health-row"><span>Records loaded</span><b>{rows.length}</b></div>
          <div className="health-row"><span>API refresh</span><b>5 seconds</b></div>
          <div className="activity-foot"><span className="activity-foot-icon"><Icon name="clock"/></span><p>Latest readings are fetched from your Room Memory API and stored telemetry history.</p></div>
        </article>
      </section>
      <footer className="page-footer"><span>ROOM MEMORY <b>·</b> IoT ENVIRONMENT PLATFORM</span><span>API: {API_BASE} <i className={error ? "footer-dot bad" : "footer-dot"}/></span></footer>
    </main>
  </div>;
}

function App() {
 const [user,setUser]=useState<AuthUser|null>(()=>readAuthUser());
 const token=window.localStorage.getItem("room-memory-auth-token");
 if (!user || !token) return <Login onLogin={setUser}/>;
 return <Dashboard user={user} onLogout={()=>{clearSession();setUser(null);}}/>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
