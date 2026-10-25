import { apiFetch } from "./auth";
import { API_BASE } from "./apiBase";
import React, { useEffect, useMemo, useState } from "react";
import "./alerts.css";

type AlertHistoryItem = {
  id: number;
  alert_key: string;
  title: string;
  sensor: string;
  measured_value: number | null;
  threshold_value: number | null;
  severity: "warning" | "critical";
  message: string;
  status: "active" | "resolved";
  opened_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

export type AlertThresholds = {
  temperatureMin: number;
  temperatureMax: number;
  humidityMin: number;
  humidityMax: number;
  pressureMin: number;
  pressureMax: number;
  rainMax: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  temperatureMin: 10,
  temperatureMax: 35,
  humidityMin: 20,
  humidityMax: 80,
  pressureMin: 950,
  pressureMax: 1050,
  rainMax: 50,
};

type Telemetry = {
  temperature?: number | null;
  pressure?: number | null;
  humidity?: number | null;
  rain_wetness?: number | null;
  ldr?: string | null;
  payload?: Record<string, any> | null;
  recorded_at: string;
};

type AlertItem = {
  key: string;
  title: string;
  message: string;
  severity: "warning" | "critical";
};

type Props = {
  onBack: () => void;
  deviceKey: string;
  latest?: Telemetry;
  thresholds: AlertThresholds;
  onThresholdsChange: (next: AlertThresholds) => void;
  lastUpdated: Date | null;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sensorValue(row: Telemetry | undefined, direct: keyof Telemetry, ...payloadKeys: string[]): number | null {
  if (!row) return null;
  const directValue = toNumber(row[direct]);
  if (directValue !== null) return directValue;
  for (const key of payloadKeys) {
    const value = toNumber(row.payload?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function evaluateAlerts(row: Telemetry | undefined, t: AlertThresholds): AlertItem[] {
  const temperature = sensorValue(row, "temperature", "dhtTemp", "dhtTemperature", "temperature");
  const humidity = sensorValue(row, "humidity", "humidity");
  const pressure = sensorValue(row, "pressure", "pressure");
  const rain = sensorValue(row, "rain_wetness", "rainWetness", "rain_wetness", "rainWetnessPercent");
  const alerts: AlertItem[] = [];

  if (temperature !== null && temperature < t.temperatureMin) alerts.push({ key: "temperature-low", title: "Temperature below range", message: `${temperature.toFixed(1)} °C is below your ${t.temperatureMin} °C minimum.`, severity: "warning" });
  if (temperature !== null && temperature > t.temperatureMax) alerts.push({ key: "temperature-high", title: "Temperature above range", message: `${temperature.toFixed(1)} °C is above your ${t.temperatureMax} °C maximum.`, severity: "critical" });
  if (humidity !== null && humidity < t.humidityMin) alerts.push({ key: "humidity-low", title: "Humidity below range", message: `${humidity.toFixed(0)}% is below your ${t.humidityMin}% minimum.`, severity: "warning" });
  if (humidity !== null && humidity > t.humidityMax) alerts.push({ key: "humidity-high", title: "Humidity above range", message: `${humidity.toFixed(0)}% is above your ${t.humidityMax}% maximum.`, severity: "warning" });
  if (pressure !== null && pressure < t.pressureMin) alerts.push({ key: "pressure-low", title: "Pressure below range", message: `${pressure.toFixed(1)} hPa is below your ${t.pressureMin} hPa minimum.`, severity: "warning" });
  if (pressure !== null && pressure > t.pressureMax) alerts.push({ key: "pressure-high", title: "Pressure above range", message: `${pressure.toFixed(1)} hPa is above your ${t.pressureMax} hPa maximum.`, severity: "warning" });
  if (rain !== null && rain >= t.rainMax) alerts.push({ key: "rain-high", title: "Rain wetness threshold reached", message: `Rain wetness is ${rain.toFixed(0)}%, meeting or exceeding your ${t.rainMax}% threshold.`, severity: "critical" });
  return alerts;
}

const FIELDS: { key: keyof AlertThresholds; label: string; unit: string; step: number; min: number; max: number; help: string }[] = [
  { key: "temperatureMin", label: "Minimum temperature", unit: "°C", step: 0.5, min: -20, max: 80, help: "Warn when temperature falls below this value." },
  { key: "temperatureMax", label: "Maximum temperature", unit: "°C", step: 0.5, min: -20, max: 80, help: "Critical warning when temperature exceeds this value." },
  { key: "humidityMin", label: "Minimum humidity", unit: "%", step: 1, min: 0, max: 100, help: "Warn when relative humidity falls below this value." },
  { key: "humidityMax", label: "Maximum humidity", unit: "%", step: 1, min: 0, max: 100, help: "Warn when relative humidity exceeds this value." },
  { key: "pressureMin", label: "Minimum pressure", unit: "hPa", step: 1, min: 300, max: 1200, help: "Warn when atmospheric pressure falls below this value." },
  { key: "pressureMax", label: "Maximum pressure", unit: "hPa", step: 1, min: 300, max: 1200, help: "Warn when atmospheric pressure exceeds this value." },
  { key: "rainMax", label: "Rain wetness alert", unit: "%", step: 1, min: 0, max: 100, help: "Critical warning when rain wetness reaches this value." },
];

export default function Alerts({ onBack, deviceKey, latest, thresholds, onThresholdsChange, lastUpdated }: Props) {
  const [draft, setDraft] = useState<AlertThresholds>(thresholds);
  const [savedMessage, setSavedMessage] = useState("");
  const [validationError, setValidationError] = useState("");
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"all" | "active" | "resolved">("all");
  const [historySeverity, setHistorySeverity] = useState<"all" | "warning" | "critical">("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const query = new URLSearchParams({ limit: "100" });
        if (historyStatus !== "all") query.set("status", historyStatus);
        if (historySeverity !== "all") query.set("severity", historySeverity);
        if (historyFrom) query.set("from", new Date(`${historyFrom}T00:00:00`).toISOString());
        if (historyTo) query.set("to", new Date(`${historyTo}T23:59:59.999`).toISOString());
        const response = await apiFetch(`${API_BASE}/api/alerts/${encodeURIComponent(deviceKey)}?${query.toString()}`);
        if (!response.ok) throw new Error(`History request failed (${response.status})`);
        const data = await response.json();
        if (!cancelled) {
          setHistory(Array.isArray(data) ? data : []);
          setHistoryError("");
        }
      } catch (error) {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : "Unable to load alert history");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    setHistoryLoading(true);
    loadHistory();
    const timer = window.setInterval(loadHistory, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [deviceKey, historyStatus, historySeverity, historyFrom, historyTo]);
  const activeAlerts = useMemo(() => evaluateAlerts(latest, thresholds), [latest, thresholds]);
  const latestTime = latest?.recorded_at ? new Date(latest.recorded_at).toLocaleString() : "No telemetry received yet";

  function update(key: keyof AlertThresholds, raw: string) {
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) return;
    setDraft(current => ({ ...current, [key]: value }));
    setSavedMessage("");
    setValidationError("");
  }

  function save() {
    if (draft.temperatureMin >= draft.temperatureMax) return setValidationError("Minimum temperature must be lower than maximum temperature.");
    if (draft.humidityMin >= draft.humidityMax) return setValidationError("Minimum humidity must be lower than maximum humidity.");
    if (draft.pressureMin >= draft.pressureMax) return setValidationError("Minimum pressure must be lower than maximum pressure.");
    if (draft.humidityMin < 0 || draft.humidityMax > 100 || draft.rainMax < 0 || draft.rainMax > 100) return setValidationError("Humidity and rain thresholds must stay between 0 and 100%.");
    onThresholdsChange(draft);
    setSavedMessage("Thresholds saved on this browser.");
    setValidationError("");
  }

  function reset() {
    setDraft(DEFAULT_THRESHOLDS);
    onThresholdsChange(DEFAULT_THRESHOLDS);
    setSavedMessage("Default thresholds restored.");
    setValidationError("");
  }

  function exportHistoryCsv() {
    const columns = [
      ["Device", deviceKey],
    ];
    const headers = ["Device", "Alert", "Alert Key", "Sensor", "Measured Value", "Threshold", "Severity", "Message", "Status", "Started At", "Last Seen At", "Resolved At"];
    const safeCell = (value: unknown) => {
      let text = value === null || value === undefined ? "" : String(value);
      if (/^[=+@\\-\\t\\r]/.test(text)) text = "'" + text;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = history.map(item => [
      deviceKey, item.title, item.alert_key, item.sensor,
      item.measured_value, item.threshold_value, item.severity, item.message,
      item.status, item.opened_at, item.last_seen_at, item.resolved_at
    ]);
    const csv = [headers, ...rows].map(row => row.map(safeCell).join(",")).join("\r\n");
    const blob = new Blob(["\\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `room-memory-alert-history-${deviceKey}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return <main className="alerts-page">
    <header className="alerts-topbar">
      <div className="alerts-brand"><div className="alerts-logo">RM</div><div><b>Room Memory</b><small>SENSOR ALERTS & THRESHOLDS</small></div></div>
      <button className="alerts-back" onClick={onBack}>← Overview</button>
    </header>

    <section className="alerts-intro">
      <div><div className="al-eyebrow">SAFETY & MONITORING</div><h1>Sensor alerts</h1><p>Configure warning thresholds for the latest readings from your ESP32.</p></div>
      <div className={`alerts-state ${activeAlerts.length ? "has-alerts" : "all-clear"}`}><span className="alerts-state-dot"/>{activeAlerts.length ? `${activeAlerts.length} active alert${activeAlerts.length === 1 ? "" : "s"}` : "All monitored values in range"}</div>
    </section>

    <section className="alerts-meta">
      <span><b>Device</b> {deviceKey}</span><span><b>Latest reading</b> {latestTime}</span><span><b>Dashboard updated</b> {lastUpdated ? lastUpdated.toLocaleTimeString() : "Waiting for API"}</span>
    </section>

    <section className="alerts-active-panel">
      <div className="al-section-heading"><div><div className="al-eyebrow">CURRENT STATUS</div><h2>Active warnings</h2></div><span className="al-count">{activeAlerts.length}</span></div>
      {!latest && <div className="al-empty">No telemetry received yet. Keep the ESP32 connected and publishing to MQTT.</div>}
      {latest && !activeAlerts.length && <div className="al-clear"><span>✓</span><div><b>No threshold alerts</b><small>The latest available sensor readings are within your configured limits.</small></div></div>}
      {!!activeAlerts.length && <div className="al-alert-list">{activeAlerts.map(alert => <article className={`al-alert-item ${alert.severity}`} key={alert.key}><span className="al-alert-symbol">{alert.severity === "critical" ? "!" : "△"}</span><div><b>{alert.title}</b><p>{alert.message}</p></div><span className="al-severity">{alert.severity === "critical" ? "Critical" : "Warning"}</span></article>)}</div>}
      <p className="al-footnote">Alerts are calculated locally from the latest telemetry and are re-evaluated when the dashboard refreshes. They are not push notifications.</p>
    </section>

    <section className="alerts-history-panel">
      <div className="al-section-heading">
        <div><div className="al-eyebrow">POSTGRESQL EVENT LOG</div><h2>Alert history</h2><p>Alert events remain available after a browser refresh or API restart.</p></div>
        <span className="al-count">{history.length}</span>
      </div>
      <div className="al-history-toolbar">
        <div className="al-history-filters">
          <label>Status <select value={historyStatus} onChange={e => setHistoryStatus(e.target.value as "all" | "active" | "resolved")}><option value="all">All statuses</option><option value="active">Active</option><option value="resolved">Resolved</option></select></label>
          <label>Severity <select value={historySeverity} onChange={e => setHistorySeverity(e.target.value as "all" | "warning" | "critical")}><option value="all">All severities</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
          <label>From <input type="date" value={historyFrom} max={historyTo || undefined} onChange={e => setHistoryFrom(e.target.value)} /></label>
          <label>To <input type="date" value={historyTo} min={historyFrom || undefined} onChange={e => setHistoryTo(e.target.value)} /></label>
          {(historyFrom || historyTo) && <button className="al-filter-clear" onClick={() => { setHistoryFrom(""); setHistoryTo(""); }}>Clear dates</button>}
        </div>
        <div className="al-export-actions"><button className="al-export" onClick={exportHistoryCsv} disabled={!history.length}>↓ Export CSV</button><button className="al-export al-export-pdf" onClick={()=>window.print()} disabled={!history.length}>▣ Export PDF</button></div>
      </div>
      {historyError && <div className="al-validation" role="alert">Could not load history: {historyError}. Check that the API migration has been applied and the API restarted.</div>}
      {historyLoading && <div className="al-empty">Loading saved alert events…</div>}
      {!historyLoading && !historyError && history.length === 0 && <div className="al-empty">No alert events match these filters yet. When a reading crosses a threshold, the event will be saved here.</div>}
      {!!history.length && <div className="al-history-table-wrap"><table className="al-history-table"><thead><tr><th>Event</th><th>Severity</th><th>Value / limit</th><th>Status</th><th>Started</th><th>Resolved</th></tr></thead><tbody>{history.map(item => <tr key={item.id}><td><b>{item.title}</b><small>{item.message}</small><small>Device {deviceKey} · {item.sensor}</small></td><td><span className={`al-history-badge ${item.severity}`}>{item.severity}</span></td><td>{item.measured_value == null ? "—" : item.measured_value} / {item.threshold_value == null ? "—" : item.threshold_value}</td><td><span className={`al-history-badge ${item.status}`}>{item.status}</span></td><td>{new Date(item.opened_at).toLocaleString()}</td><td>{item.resolved_at ? new Date(item.resolved_at).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="alerts-config-panel">
      <div className="al-section-heading"><div><div className="al-eyebrow">CONFIGURATION</div><h2>Threshold settings</h2><p>Values are saved in this browser and apply to the selected device view.</p></div><button className="al-reset" onClick={reset}>Reset defaults</button></div>
      <div className="al-threshold-grid">
        {FIELDS.map(field => <label className="al-threshold-field" key={field.key}><span>{field.label}</span><div className="al-input-wrap"><input type="number" min={field.min} max={field.max} step={field.step} value={draft[field.key]} onChange={e=>update(field.key,e.target.value)}/><em>{field.unit}</em></div><small>{field.help}</small></label>)}
      </div>
      {validationError && <div className="al-validation" role="alert">{validationError}</div>}
      {savedMessage && <div className="al-saved" role="status">{savedMessage}</div>}
      <div className="al-config-actions"><span>Default limits are starting values. Adjust them for your room and sensor calibration.</span><button className="al-save" onClick={save}>Save thresholds</button></div>
    </section>
    <footer className="al-footer">ROOM MEMORY · ALERT EVALUATION <span>Local browser configuration · MQTT telemetry source</span></footer>
  </main>;
}
