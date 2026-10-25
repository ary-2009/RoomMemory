import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownToLine, Bell, CheckCircle2, ChevronDown, Cloud, Cpu, Download, Image, LayoutDashboard, Power, Radio, ShieldCheck, SlidersHorizontal, Thermometer, UploadCloud, Users, Waves, Wind } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const demoReadings = Array.from({length:24},(_,i)=>({
  time:`${String(i).padStart(2,'0')}:00`,
  temperature: 25 + Math.sin(i/3)*2.6 + i*0.12,
  humidity: 58 + Math.cos(i/4)*7,
  pressure: 1001 + Math.sin(i/5)*2
}));
type Tab = 'overview'|'devices'|'alerts'|'reports'|'display'|'firmware'|'admin';
export default function App(){
  const [tab,setTab]=useState<Tab>('overview');
  const [admin,setAdmin]=useState(false);
  const [standby,setStandby]=useState(false);
  const [threshold,setThreshold]=useState(35);
  const [bgName,setBgName]=useState('');
  const [selectedImage,setSelectedImage]=useState<File|null>(null);
  const [notice,setNotice]=useState('Demo mode — connect the API and MQTT services for live device data.');
  const isAdmin=admin || tab==='admin';
  const menu = useMemo(()=>[
    {id:'overview' as Tab,label:'Overview',icon:LayoutDashboard},
    {id:'devices' as Tab,label:'My devices',icon:Cpu},
    {id:'alerts' as Tab,label:'Alerts & events',icon:Bell},
    {id:'reports' as Tab,label:'Reports & exports',icon:ArrowDownToLine},
    {id:'display' as Tab,label:'TFT background',icon:Image},
    {id:'firmware' as Tab,label:'Firmware OTA',icon:UploadCloud},
    {id:'admin' as Tab,label:'Company admin',icon:ShieldCheck}
  ],[]);
  function exportCsv(){
    const rows=[['time','temperature_c','humidity_pct','pressure_hpa'],...demoReadings.map(r=>[r.time,r.temperature.toFixed(1),r.humidity.toFixed(1),r.pressure.toFixed(1)])];
    const csv=rows.map(r=>r.join(',')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    const a=document.createElement('a');a.href=url;a.download='room-memory-demo-report.csv';a.click();URL.revokeObjectURL(url);
    setNotice('Demo CSV exported. Production exports should come from authorized server-side data.');
  }
  async function pickImage(file:File|null){
    setSelectedImage(file); setBgName(file?.name||'');
    if(!file) return;
    if(!file.type.startsWith('image/')) {setNotice('Please choose a supported image file.');return;}
    if(file.size>5*1024*1024){setNotice('Image is larger than the recommended 5 MB limit.');return;}
    setNotice(`Selected ${file.name}. In production, convert to 320×240 RGB565 and upload to the authenticated device endpoint.`);
  }
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandmark"><Waves size={22}/></div><div><strong>room memory</strong><span>IoT CONTROL PLANE</span></div></div>
      <div className="workspace"><span className="pulse"></span> Workspace <ChevronDown size={14}/></div>
      <div className="navlabel">WORKSPACE</div>
      {menu.map(m=><button key={m.id} className={`navitem ${tab===m.id?'active':''}`} onClick={()=>setTab(m.id)}><m.icon size={17}/>{m.label}{m.id==='alerts'&&<span className="count">2</span>}</button>)}
      <div className="sidebar-bottom"><div className="secure"><ShieldCheck size={17}/><div><b>Secure by design</b><span>Device-scoped access</span></div></div><div className="profile"><div className="avatar">AB</div><div><b>{admin?'Company Admin':'Device Owner'}</b><span>{admin?'Fleet management':'owner@example.com'}</span></div><button className="iconbtn" onClick={()=>setAdmin(!admin)} title="Switch demo role"><Users size={16}/></button></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="crumb">Workspace <span>/</span> {menu.find(m=>m.id===tab)?.label}</div><div className="topactions"><span className="env"><span className="pulse"></span> DEMO ENVIRONMENT</span><button className="iconbtn" onClick={()=>setTab('alerts')}><Bell size={18}/><i></i></button><div className="avatar smallavatar">{admin?'CA':'AB'}</div></div></header>
      <div className="content">
        <div className="pagehead"><div><div className="eyebrow">ROOM MEMORY / {isAdmin?'FLEET CONSOLE':'OWNER CONSOLE'}</div><h1>{tab==='overview'?'Good evening.':menu.find(m=>m.id===tab)?.label}</h1><p>{tab==='overview'?'Here is the current health of your environment.':tab==='admin'?'Company-wide device fleet, firmware releases and customer operations.':'Manage your Room Memory device and its data.'}</p></div><button className="btn primary" onClick={()=>setTab('devices')}><Radio size={16}/> View device</button></div>
        {notice&&<div className="notice"><CheckCircle2 size={16}/><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}
        {tab==='overview'&&<>
          <div className="devicebanner"><div className="deviceicon"><Cpu size={25}/></div><div className="devicename"><b>Room Memory — RM-001</b><span><span className="pulse"></span> Online · Demo telemetry · Last seen just now</span></div><div className="firmwaretag">FIRMWARE <b>0.1.0</b></div><button className={`btn ${standby?'':'outline'}`} onClick={()=>{setStandby(!standby);setNotice(standby?'Standby release requested (demo only).':'Standby requested (demo only). A real device needs an authenticated cloud command.')}}><Power size={15}/>{standby?'Wake request':'Standby'}</button></div>
          <div className="metricgrid">
            <Metric icon={<Thermometer/>} label="AIR TEMPERATURE" value="28.4" unit="°C" foot="Normal range" color="cyan"/>
            <Metric icon={<Waves/>} label="RELATIVE HUMIDITY" value="61" unit="%" foot="Comfortable" color="violet"/>
            <Metric icon={<Wind/>} label="AIR PRESSURE" value="1001.8" unit="hPa" foot="Stable" color="green"/>
            <Metric icon={<Activity/>} label="RAIN WETNESS" value="8" unit="%" foot="Sensor appears dry" color="amber"/>
          </div>
          <div className="grid2"><section className="panel chartpanel"><div className="panelhead"><div><h2>Environment history</h2><p>Temperature · last 24 hours</p></div><select aria-label="Time range"><option>24 hours</option><option>7 days</option><option>30 days</option></select></div><div className="chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={demoReadings} margin={{top:12,right:12,bottom:0,left:-14}}><CartesianGrid stroke="#23334a" strokeDasharray="3 5"/><XAxis dataKey="time" stroke="#7d8ca3" tickLine={false} axisLine={false} interval={3}/><YAxis stroke="#7d8ca3" tickLine={false} axisLine={false} domain={[20,40]}/><Tooltip contentStyle={{background:'#111d2d',border:'1px solid #2d4059',borderRadius:10}}/><Line type="monotone" dataKey="temperature" stroke="#4de1c1" strokeWidth={3} dot={false} activeDot={{r:5}}/></LineChart></ResponsiveContainer></div><div className="chartfoot"><span><i className="legend"></i> Temperature</span><span>Sample data · connect backend for real readings</span></div></section>
          <section className="panel healthpanel"><div className="panelhead"><div><h2>Device health</h2><p>RM-001 · Environmental monitor</p></div><span className="healthy"><CheckCircle2 size={14}/> HEALTHY</span></div><Health label="DHT11 temperature / humidity" value="Operational" ok/><Health label="BMP280 pressure" value="Operational" ok/><Health label="LDR digital input · GPIO34" value="HIGH" ok/><Health label="Rain sensor · GPIO35" value="Operational" ok/><Health label="Firmware" value="Up to date" ok/><div className="alertbox"><AlertTriangle size={17}/><div><b>2 recent events</b><span>Review alerts and sensor history.</span></div><button onClick={()=>setTab('alerts')}>Review</button></div></section></div>
        </>}
        {tab==='devices'&&<section className="panel"><div className="panelhead"><div><h2>Registered devices</h2><p>Owners can only access devices assigned to their account.</p></div><button className="btn primary" onClick={()=>setNotice('Device registration flow should provision a unique device identity and pairing code.')}>+ Register device</button></div><div className="tablewrap"><table><thead><tr><th>DEVICE</th><th>STATUS</th><th>FIRMWARE</th><th>LAST SEEN</th><th>ACTION</th></tr></thead><tbody><tr><td><b>Room Memory — RM-001</b><small>ESP32 · ST7789</small></td><td><span className="healthy"><i className="pulse"></i> Online</span></td><td>0.1.0</td><td>Just now · Demo</td><td><button className="btn outline" onClick={()=>setTab('overview')}>Open</button></td></tr></tbody></table></div></section>}
        {tab==='alerts'&&<section className="panel"><div className="panelhead"><div><h2>Alerts & events</h2><p>Threshold warnings and device health events.</p></div><button className="btn outline" onClick={()=>setNotice('Alert preferences are a UI prototype; notification providers are not configured.')}>Alert settings</button></div><AlertRow severity="warning" title="Example: temperature threshold exceeded" detail="Sample event · configure per-device threshold to enable production alerts."/><AlertRow severity="info" title="Example: sensor heartbeat received" detail="Sample event · no live MQTT feed is connected."/><AlertRow severity="critical" title="Example: sensor read failed repeatedly" detail="Production firmware should emit a fault event after repeated failed readings."/></section>}
        {tab==='reports'&&<section className="panel"><div className="panelhead"><div><h2>Reports & exports</h2><p>Export history for the selected device and time range.</p></div></div><div className="exportgrid"><div className="exportcard"><ArrowDownToLine/><b>CSV data export</b><span>Raw readings for spreadsheets and analysis.</span><button className="btn primary" onClick={exportCsv}><Download size={15}/> Download demo CSV</button></div><div className="exportcard"><Download/><b>Visual PDF report</b><span>Charts, summary statistics, device status and alerts.</span><button className="btn outline" onClick={()=>setNotice('PDF generation is planned for the API service; this starter does not generate a production PDF yet.')} >Prepare PDF report</button></div></div></section>}
        {tab==='display'&&<section className="panel"><div className="panelhead"><div><h2>TFT background manager</h2><p>Upload a landscape background for the 320 × 240 ST7789 display.</p></div><span className="firmwaretag">MAX 5 MB</span></div><div className="displaylayout"><div className="tftpreview"><div className="previewtop">ROOM MEMORY <span>ONLINE</span></div><div className="previewmetrics"><div><small>TEMPERATURE</small><b>28.4°C</b></div><div><small>HUMIDITY</small><b>61%</b></div><div><small>PRESSURE</small><b>1001 hPa</b></div><div><small>RAIN</small><b>8%</b></div></div><div className="previewgraph"><svg viewBox="0 0 280 60" preserveAspectRatio="none"><path d="M0,42 L25,38 L50,45 L75,25 L100,31 L125,20 L150,27 L175,15 L200,25 L225,11 L250,20 L280,8" fill="none" stroke="#4de1c1" strokeWidth="3"/></svg></div></div><div className="uploadbox"><div className="uploadicon"><Image size={25}/></div><h3>Choose a background image</h3><p>PNG, JPG or WebP. It will be fitted to the screen without cropping in the full implementation.</p><label className="btn outline filebutton"><UploadCloud size={16}/> Choose image<input type="file" accept="image/*" onChange={e=>pickImage(e.target.files?.[0]||null)}/></label>{bgName&&<div className="filename">{bgName}</div>}<button className="btn primary" disabled={!selectedImage} onClick={()=>setNotice('Image selected locally only. Production upload requires owner-authenticated API, RGB565 conversion, device delivery and persistence.')}>Upload to device</button></div></div></section>}
        {tab==='firmware'&&<section className="panel"><div className="panelhead"><div><h2>Firmware releases & OTA</h2><p>Company administrators publish firmware; owners can see update status for their devices.</p></div><span className="healthy"><ShieldCheck size={14}/> SIGNED OTA REQUIRED</span></div><div className="otaSteps"><div><span>01</span><b>Build firmware</b><small>Exact board + OTA partition layout</small></div><div><span>02</span><b>Sign release</b><small>Digest and signature verification</small></div><div><span>03</span><b>Roll out safely</b><small>Canary → staged fleet → confirm</small></div></div>{isAdmin&&<div className="uploadbox wide"><h3>Publish a firmware release</h3><input type="text" placeholder="Version e.g. 1.0.1"/><input type="file" accept=".bin,application/octet-stream"/><button className="btn primary" onClick={()=>setNotice('Demo only: production must upload artifact to private object storage, calculate SHA-256, sign manifest and authorize rollout.')}>Create draft release</button></div>}<div className="alertbox"><ShieldCheck size={18}/><div><b>Security requirement</b><span>Do not expose the ESP32 local HTTP updater to the public internet. Use signed manifests, TLS, device identity, rollback and audit logs.</span></div></div></section>}
        {tab==='admin'&&<section className="panel"><div className="panelhead"><div><h2>Company fleet administration</h2><p>Demo admin view — role enforcement must be implemented on the API, not just in this UI.</p></div><span className="firmwaretag">COMPANY ADMIN</span></div><div className="metricgrid"><Metric icon={<Cpu/>} label="REGISTERED DEVICES" value="128" unit="" foot="Demo metric" color="cyan"/><Metric icon={<Radio/>} label="ONLINE NOW" value="117" unit="" foot="Demo metric" color="green"/><Metric icon={<AlertTriangle/>} label="OPEN ALERTS" value="6" unit="" foot="Demo metric" color="amber"/><Metric icon={<UploadCloud/>} label="FIRMWARE RELEASE" value="1.2.0" unit="" foot="Demo release" color="violet"/></div><div className="adminactions"><button className="btn outline" onClick={()=>setNotice('Customer management must use authenticated, audited API routes.')}>Manage customers</button><button className="btn outline" onClick={()=>setTab('firmware')}>Firmware releases</button><button className="btn outline" onClick={()=>setNotice('Device diagnostic report is a planned backend feature.')}>Export fleet diagnostics</button></div></section>}
        <footer><span>ROOM MEMORY · IoT CONTROL PLANE</span><span><span className="pulse"></span> Demo UI · Not connected to live devices</span></footer>
      </div>
    </main>
  </div>
}
function Metric({icon,label,value,unit,foot,color}:{icon:React.ReactNode,label:string,value:string,unit:string,foot:string,color:string}){
 return <div className="metric"><div className="metrichead"><span>{label}</span><i className={`metricicon ${color}`}>{icon}</i></div><div className="metricvalue">{value}<small>{unit}</small></div><div className="metricfoot"><span className="pulse"></span>{foot}</div></div>
}
function Health({label,value,ok}:{label:string,value:string,ok?:boolean}){return <div className="healthrow"><div><span className="pulse"></span>{label}</div><b className={ok?'oktext':''}>{value}</b></div>}
function AlertRow({severity,title,detail}:{severity:string,title:string,detail:string}){return <div className="eventrow"><span className={`eventicon ${severity}`}><AlertTriangle size={17}/></span><div><b>{title}</b><p>{detail}</p></div><span className="eventtime">Demo</span></div>}
