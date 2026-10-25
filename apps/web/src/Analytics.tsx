import { apiFetch } from "./auth";
import { API_BASE } from "./apiBase";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import "./analytics.css";
const REFRESH_MS = 15000;

type Device = { device_key: string; name: string; status?: string };
type Reading = {
  id?: number | string;
  device_key?: string;
  recorded_at?: string;
  created_at?: string;
  timestamp?: string;
  temperature?: number | string | null;
  pressure?: number | string | null;
  humidity?: number | string | null;
  rain_wetness?: number | string | null;
  rainWetness?: number | string | null;
  payload?: Record<string, unknown> | null;
};

type RangeKey = "1h" | "24h" | "7d" | "30d" | "custom";

function asNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function readingTime(r: Reading): number {
  const raw = r.recorded_at || r.created_at || r.timestamp;
  return raw ? new Date(raw).getTime() : NaN;
}
function fmtDate(ms: number) {
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtValue(n: number | null, digits = 1) {
  return n === null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
function downloadCsv(rows: Reading[], deviceKey: string) {
  const header = ["timestamp", "device_key", "dht11_room_temperature_c", "pressure_hpa", "humidity_percent", "rain_wetness_percent"];
  const lines = rows.map(r => {
    const payload = r.payload || {};
    const time = r.recorded_at || r.created_at || r.timestamp || "";
    const values = [
      time, r.device_key || deviceKey,
      asNumber(r.temperature, payload.dhtTemp, payload.dhtTemperature, payload.temperature),
      asNumber(r.pressure, payload.pressure),
      asNumber(r.humidity, payload.humidity),
      asNumber(r.rain_wetness, r.rainWetness, payload.rain_wetness, payload.rainWetness)
    ];
    return values.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
  });
  const csv = [header.join(","), ...lines].join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `room-memory-${deviceKey}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function LineChart({ title, unit, color, values, digits = 1 }: {
  title: string; unit: string; color: string; values: { time: number; value: number | null }[]; digits?: number;
}) {
  const data = values.filter(p => p.value !== null && Number.isFinite(p.time));
  const W = 760, H = 250, L = 48, R = 18, T = 20, B = 32;
  const nums = data.map(p => p.value as number);
  const low = nums.length ? Math.min(...nums) : 0;
  const high = nums.length ? Math.max(...nums) : 1;
  const padding = Math.max((high - low) * .15, Math.abs(high) * .01, .5);
  const min = low - padding, max = high + padding, span = max - min || 1;
  const points = data.map((p, i) => ({
    x: L + (data.length <= 1 ? 0 : i * (W - L - R) / (data.length - 1)),
    y: T + (H - T - B) * (1 - ((p.value as number) - min) / span),
    value: p.value as number,
    time: p.time
  }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const area = points.length ? `${L},${H-B} ${polyline} ${points[points.length-1].x},${H-B}` : "";
  return <section className="analytics-chart">
    <div className="ac-head"><div><h3>{title}</h3><p>{data.length} readings · {unit}</p></div><span className="ac-legend"><i style={{background:color}}/>{title}</span></div>
    {data.length < 2 ? <div className="ac-empty">Not enough historical readings for a chart yet.<small>Keep the ESP32 publishing telemetry and refresh after more readings arrive.</small></div> :
      <div className="ac-svg-wrap"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} history chart`}>
        {[0,1,2,3].map(i => {
          const y = T + i * (H-T-B)/3;
          const val = max - i*span/3;
          return <g key={i}><line x1={L} x2={W-R} y1={y} y2={y} className="ac-grid"/><text x={L-8} y={y+4} textAnchor="end" className="ac-axis">{val.toFixed(digits)}</text></g>;
        })}
        <polygon points={area} fill={color} opacity=".10"/>
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        {points.length < 40 && points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3" fill="#fff" stroke={color} strokeWidth="2"><title>{`${p.value.toFixed(digits)} ${unit} · ${new Date(p.time).toLocaleString()}`}</title></circle>)}
      </svg><div className="ac-time-labels"><span>{fmtDate(data[0].time)}</span><span>{fmtDate(data[data.length-1].time)}</span></div></div>}
  </section>;
}

export default function Analytics({ onBack }: { onBack?: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceKey, setDeviceKey] = useState("RM-001");
  const [range, setRange] = useState<RangeKey>("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [allRows, setAllRows] = useState<Reading[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, tRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/devices`, { cache: "no-store" }),
        // Existing telemetry endpoint. The limit parameter is supported by the included API reference patch.
        apiFetch(`${API_BASE}/api/telemetry/${encodeURIComponent(deviceKey)}?limit=2000`, { cache: "no-store" })
      ]);
      if (!dRes.ok) throw new Error(`Devices API: HTTP ${dRes.status}`);
      if (!tRes.ok) throw new Error(`Telemetry API: HTTP ${tRes.status}`);
      const [d, t] = await Promise.all([dRes.json(), tRes.json()]);
      if (!Array.isArray(d) || !Array.isArray(t)) throw new Error("API returned an unexpected response shape.");
      setDevices(d);
      setAllRows(t);
      setUpdatedAt(new Date());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to fetch analytics data.");
    } finally {
      setLoading(false);
    }
  }, [deviceKey]);

  useEffect(() => {
    void fetchData();
    const timer = window.setInterval(() => void fetchData(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [fetchData]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const durations: Record<Exclude<RangeKey, "custom">, number> = {
      "1h": 3600000,
      "24h": 86400000,
      "7d": 604800000,
      "30d": 2592000000
    };
    let from = range === "custom" ? 0 : now - durations[range];
    let to = now;
    if (range === "custom") {
      from = customFrom ? new Date(customFrom).getTime() : 0;
      to = customTo ? new Date(customTo).getTime() : now;
    }
    return allRows.filter(r => {
      const time = readingTime(r);
      return Number.isFinite(time) && time >= from && time <= to;
    }).sort((a,b) => readingTime(b)-readingTime(a));
  }, [allRows, range, customFrom, customTo]);

  const series = useMemo(() => {
    const ordered = [...filtered].reverse();
    return {
      temperature: ordered.map(r => ({time:readingTime(r), value:asNumber(r.temperature,r.payload?.dhtTemp,r.payload?.dhtTemperature,r.payload?.temperature)})),
      pressure: ordered.map(r => ({time:readingTime(r), value:asNumber(r.pressure,r.payload?.pressure)})),
      humidity: ordered.map(r => ({time:readingTime(r), value:asNumber(r.humidity,r.payload?.humidity)})),
      rain: ordered.map(r => ({time:readingTime(r), value:asNumber(r.rain_wetness,r.rainWetness,r.payload?.rain_wetness,r.payload?.rainWetness,r.payload?.rainWetnessPercent)}))
    };
  }, [filtered]);

  const average = (key: "temperature"|"pressure"|"humidity"|"rain") => {
    const vals = series[key].map(p=>p.value).filter((v):v is number=>v!==null);
    return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
  };
  const latest = filtered[0];
  const device = devices.find(d=>d.device_key===deviceKey);

  return <main className="analytics-page">
    <header className="analytics-topbar">
      <div className="analytics-brand"><div className="analytics-logo">RM</div><div><b>Room Memory</b><small>ENVIRONMENT ANALYTICS</small></div></div>
      <div className="analytics-top-actions"><button className="ac-back" onClick={onBack}>← Overview</button><div className="analytics-live"><i/> TELEMETRY ANALYTICS</div></div>
    </header>
    <section className="analytics-intro">
      <div><div className="ac-eyebrow">DATA & INSIGHTS</div><h1>Sensor analytics</h1><p>Explore historical room conditions and export readings for further analysis.</p></div>
      <div className="ac-export-actions"><button className="ac-export" onClick={()=>downloadCsv(filtered,deviceKey)} disabled={!filtered.length}>↓ Export CSV</button><button className="ac-export ac-export-pdf" onClick={()=>window.print()} disabled={!filtered.length}>▣ Export PDF</button></div>
    </section>
    {error && <div className="ac-error"><b>Unable to load analytics</b><span>{error}. Confirm the API is running and the telemetry route is installed.</span><button onClick={()=>void fetchData()}>Retry</button></div>}
    <section className="ac-filter-panel">
      <label>DEVICE<select value={deviceKey} onChange={e=>setDeviceKey(e.target.value)}>{(devices.length?devices:[{device_key:"RM-001",name:"Room Memory ESP32"}]).map(d=><option key={d.device_key} value={d.device_key}>{d.name} ({d.device_key})</option>)}</select></label>
      <div className="ac-range"><span>TIME RANGE</span><div>{(["1h","24h","7d","30d","custom"] as RangeKey[]).map((r)=><button key={r} className={range===r?"selected":""} onClick={()=>setRange(r)}>{({"1h":"1 hour","24h":"24 hours","7d":"7 days","30d":"30 days","custom":"Custom"} as const)[r]}</button>)}</div></div>
      {range==="custom"&&<div className="ac-custom"><label>FROM<input type="datetime-local" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}/></label><label>TO<input type="datetime-local" value={customTo} onChange={e=>setCustomTo(e.target.value)}/></label></div>}
      <button className="ac-refresh" onClick={()=>void fetchData()} disabled={loading}>↻ {loading?"Loading":"Refresh"}</button>
    </section>
    <div className="ac-meta"><span><i className={`ac-status ${device?.status?.toLowerCase()==="online"?"online":""}`}/>{device?.name||deviceKey} · {device?.status||"status unknown"}</span><span>{filtered.length} readings in range</span><span>{updatedAt?`Updated ${updatedAt.toLocaleTimeString()}`:"Not updated yet"} · Auto-refresh 15s</span></div>
    <section className="ac-summary-grid">
      {[{label:"Average temperature",value:average("temperature"),unit:"°C",tone:"temp"},{label:"Average pressure",value:average("pressure"),unit:"hPa",tone:"pressure"},{label:"Average humidity",value:average("humidity"),unit:"%",tone:"humidity"},{label:"Average rain wetness",value:average("rain"),unit:"%",tone:"rain"}].map(c=><article className="ac-summary" key={c.label}><span className={`ac-summary-icon ${c.tone}`}>{c.tone==="temp"?"℃":c.tone==="pressure"?"↗":c.tone==="humidity"?"◌":"☂"}</span><div><small>{c.label}</small><strong>{fmtValue(c.value,c.tone==="pressure"?1:1)}<em>{c.unit}</em></strong></div></article>)}
    </section>
    <section className="ac-chart-grid">
      <LineChart title="DHT11 room temperature" unit="°C" color="#e78c4c" values={series.temperature}/>
      <LineChart title="Atmospheric pressure" unit="hPa" color="#8c79d8" values={series.pressure}/>
      <LineChart title="Humidity" unit="%" color="#4d9ce0" values={series.humidity}/>
      <LineChart title="Rain wetness" unit="%" color="#39aaa0" values={series.rain}/>
    </section>
    <section className="ac-table-card">
      <div className="ac-table-head"><div><h2>Reading history</h2><p>Most recent readings in the selected time range</p></div><span>{filtered.length} rows</span></div>
      <div className="ac-table-scroll"><table><thead><tr><th>Timestamp</th><th>DHT11 room temperature</th><th>Pressure</th><th>Humidity</th><th>Rain wetness</th></tr></thead><tbody>
        {filtered.slice(0,100).map((r,i)=><tr key={r.id??`${readingTime(r)}-${i}`}><td>{Number.isFinite(readingTime(r))?new Date(readingTime(r)).toLocaleString():"—"}</td><td>{fmtValue(asNumber(r.temperature,r.payload?.dhtTemp,r.payload?.dhtTemperature,r.payload?.temperature))} °C</td><td>{fmtValue(asNumber(r.pressure,r.payload?.pressure))} hPa</td><td>{fmtValue(asNumber(r.humidity,r.payload?.humidity),0)}%</td><td>{fmtValue(asNumber(r.rain_wetness,r.rainWetness,r.payload?.rain_wetness,r.payload?.rainWetness))}%</td></tr>)}
        {!filtered.length&&<tr><td colSpan={5} className="ac-no-data">{loading?"Loading telemetry…":"No readings found in this time range."}</td></tr>}
      </tbody></table></div>
      {filtered.length>100&&<p className="ac-table-note">Showing the newest 100 rows here. CSV export includes all {filtered.length} readings returned for this range.</p>}
    </section>
    <footer className="ac-footer">ROOM MEMORY · HISTORICAL SENSOR ANALYTICS <span>Source: {API_BASE}</span></footer>
  </main>;
}
