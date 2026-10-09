/* DiagnosticOS frontend. All data comes from the API; live readings come only from a real ELM327 adapter
 * (or from the clearly labelled demo mode). No inline handlers: the CSP forbids them, so clicks use data-act. */
(() => {
'use strict';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => 'R' + ((c || 0) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? String(d).slice(0, 10) : '—');
const fullName = (c) => (c ? `${c.first_name} ${c.last_name || ''}`.trim() : '—');
const vehLabel = (v) => (v ? `${v.make} ${v.model}${v.year ? ' ' + v.year : ''}${v.plate ? ' · ' + v.plate : ''}` : '—');
let toastTimer;
function toast(msg, kind = 'info') {
  const t = $('#toast'); t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 4200);
}

// ---------- API ----------
let token = null;
try { token = localStorage.getItem('dos_token'); } catch (_) { /* storage blocked */ }
const state = { user: null, billing: null, ref: {}, page: 'dashboard' };

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 204) return null;
  let data = null; try { data = await r.json(); } catch (_) { /* no body */ }
  if (!r.ok) {
    if (r.status === 401 && token && !path.startsWith('/auth/login')) { logout(); }
    const err = new Error((data && data.error) || `Request failed (${r.status})`);
    err.status = r.status; err.code = data && data.code; throw err;
  }
  return data;
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, 'error'); if (e.status === 402) { loadBilling().then(renderBanner); } } };

// ---------- auth ----------
function setToken(t) { token = t; try { t ? localStorage.setItem('dos_token', t) : localStorage.removeItem('dos_token'); } catch (_) { /* ignore */ } }
function logout() { setToken(null); state.user = null; elm.disconnect(); location.hash = ''; $('#screen-app').classList.remove('visible'); $('#screen-landing').style.display = 'flex'; }
async function enterApp(user) {
  state.user = user;
  $('#screen-landing').style.display = 'none';
  $('#screen-app').classList.add('visible');
  $('#nav-shop').textContent = user.tenant.name;
  $('#user-av').textContent = user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  state.ref = await api('/reference/cars').then((cars) => ({ cars }));
  await loadBilling(); renderBanner(); buildNav();
  go(location.hash.slice(1) || 'dashboard');
}
async function loadBilling() { state.billing = await api('/billing'); $('#nav-plan').textContent = (state.billing.plan + (state.billing.planStatus === 'trial' ? ' · trial' : '')).toUpperCase(); return state.billing; }
function renderBanner() {
  const b = state.billing; const el = $('#banner');
  if (!b) { el.innerHTML = ''; return; }
  if (!b.active) el.innerHTML = '<div class="bn red">Your trial has ended or your subscription is inactive — the account is read-only. <button class="btn sm primary" data-act="nav" data-arg="billing">Choose a plan</button></div>';
  else if (state.user && state.user.emailVerified === false) el.innerHTML = '<div class="bn">Please verify your email address — we sent you a link. <button class="btn sm" data-act="resend-verify">Resend email</button></div>';
  else if (b.planStatus === 'trial') {
    const left = Math.max(0, Math.ceil((new Date(b.trialEndsAt) - Date.now()) / 86400000));
    el.innerHTML = `<div class="bn">Free trial: ${left} day${left === 1 ? '' : 's'} left. <button class="btn sm primary" data-act="nav" data-arg="billing">Subscribe</button></div>`;
  } else el.innerHTML = '';
}

// ---------- navigation ----------
const PAGES = [
  ['Diagnostics', [['dashboard', '◈', 'Dashboard'], ['scanner', '⚡', 'Live scanner'], ['history', '📊', 'Scan history'], ['dtc', '⚠', 'Fault codes'], ['tune', '🏁', 'Tuning'], ['terminal', '⌨', 'Terminal'], ['pidref', '≡', 'PID reference']]],
  ['Workshop', [['jobs', '🛠', 'Jobs board'], ['customers', '👥', 'Customers'], ['vehicles', '🚗', 'Vehicles'], ['tuning', '📈', 'Remap log'], ['inspections', '📋', 'Inspections'], ['parts', '🔩', 'Parts & stock'], ['invoices', '💰', 'Invoices & quotes'], ['reports', '🖨', 'Vehicle report']]],
  ['Account', [['settings', '⚙', 'Settings'], ['team', '👤', 'Team'], ['audit', '🕘', 'Audit log'], ['billing', '💳', 'Billing']]],
];
function buildNav() {
  $('#sidebar').innerHTML = PAGES.map(([label, items]) => `<div class="sb-section"><div class="sb-label">${label}</div>${
    items.map(([k, i, n]) => `<div class="sb-item" data-act="nav" data-arg="${k}" data-nav="${k}"><span class="sb-icon">${i}</span>${n}</div>`).join('')}</div>`).join('') +
    '<div class="sb-section"><div class="sb-item" data-act="logout"><span class="sb-icon">↩</span>Sign out</div></div>';
}
async function go(page) {
  if (!PAGES.some(([, items]) => items.some(([k]) => k === page))) page = 'dashboard';
  state.page = page; location.hash = page;
  document.querySelectorAll('[data-nav]').forEach((e) => e.classList.toggle('active', e.dataset.nav === page));
  const main = $('#main'); main.innerHTML = '<div class="page active"><div class="empty">Loading…</div></div>';
  try { await views[page](main); } catch (e) { main.innerHTML = `<div class="page active"><div class="empty">${esc(e.message)}</div></div>`; }
}
const page = (title, sub, actions, inner) => `<div class="page active"><div class="page-hdr"><div><div class="page-title">${title}</div><div class="page-sub">${sub}</div></div><div class="page-actions">${actions || ''}</div></div>${inner}</div>`;
const table = (heads, rows, empty = 'Nothing here yet.') => rows.length
  ? `<div class="tbl-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="empty">${empty}</div>`;
const stat = (c, l, v, s = '') => `<div class="stat-card ${c}"><div class="stat-card-label">${l}</div><div class="stat-card-value">${v}</div><div class="stat-card-sub">${s}</div></div>`;
const vehOptions = (vs, sel) => '<option value="">— select vehicle —</option>' + vs.map((v) => `<option value="${v.id}"${String(sel) === String(v.id) ? ' selected' : ''}>${esc(vehLabel(v))}</option>`).join('');
const custOptions = (cs, sel) => '<option value="">— none —</option>' + cs.map((c) => `<option value="${c.id}"${String(sel) === String(c.id) ? ' selected' : ''}>${esc(fullName(c))}</option>`).join('');

// ---------- modal ----------
let modalSubmit = null;
function openModal(title, inner, onSubmit, submitLabel = 'Save') {
  $('#modal-box').innerHTML = `<form id="modal-form"><div class="modal-title">${title}</div>${inner}<div id="modal-err" class="auth-err"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" type="button" data-act="close-modal">Cancel</button><button class="btn primary" type="submit">${submitLabel}</button></div></form>`;
  modalSubmit = onSubmit; $('#modal').classList.add('open');
}
const closeModal = () => { $('#modal').classList.remove('open'); modalSubmit = null; };
const fd = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- ELM327 connection (shared by scanner, faults, terminal) ----------
const termLog = [];
const elm = new ELM327({ onLog: (dir, text) => { termLog.push([dir, text]); if (termLog.length > 500) termLog.shift(); const t = $('#terminal'); if (t) appendTerm(dir, text); } });
function appendTerm(dir, text) {
  const t = $('#terminal'); if (!t) return;
  const cls = dir === '>' ? 't-cmd' : dir === '!' ? 't-err' : 't-res';
  t.insertAdjacentHTML('beforeend', `<div class="${cls}">${dir === '>' ? '› ' : ''}${esc(text).replace(/\n/g, '<br>')}</div>`);
  t.scrollTop = t.scrollHeight;
}
function setConn(label, live) { $('#conn-label').textContent = label; $('#conn-btn').classList.toggle('live', !!live); }
const connect = guard(async () => {
  if (!ELM327.isSupported()) return toast('Web Serial needs Chrome or Edge on a computer.', 'error');
  setConn('CONNECTING…', false);
  try {
    const proto = ($('#proto-sel') && $('#proto-sel').value) || 'ATSP0';
    const baud = Number(($('#baud-sel') && $('#baud-sel').value) || 38400);
    const r = await elm.connect({ baudRate: baud, protocolCmd: proto });
    setConn('LIVE · ' + (r.protocol || 'connected'), true);
    toast('Connected: ' + r.protocol, 'success');
  } catch (e) {
    await elm.disconnect(); setConn('CONNECT OBD2', false);
    if (e.name === 'NotFoundError') return; // user closed the port picker
    throw e;
  }
  if (state.page === 'scanner') go('scanner');
});
async function disconnect() { stopLive(false); await elm.disconnect(); setConn('CONNECT OBD2', false); }

// ---------- live scanner ----------
const live = { running: false, demo: false, stats: {}, samples: [], timer: null, pids: [], started: null };
function stopLive(save = true) {
  const wasRunning = live.running; live.running = false; clearTimeout(live.timer);
  if (wasRunning && save) saveScan();
}
const saveScan = guard(async () => {
  const keys = Object.keys(live.stats);
  if (!keys.length) return;
  const summary = {};
  for (const k of keys) { const s = live.stats[k]; summary[k] = { name: s.name, unit: s.unit, min: s.min, max: s.max, avg: +(s.sum / s.n).toFixed(2), n: s.n }; }
  const vehicleId = $('#scan-vehicle') ? Number($('#scan-vehicle').value) || null : null;
  const saved = await api('/scans', { method: 'POST', body: { vehicle_id: vehicleId, protocol: live.demo ? 'demo' : elm.protocol, source: live.demo ? 'demo' : 'adapter', summary, samples: live.samples.slice(-300) } });
  toast(`Scan saved (#${saved.id})${live.demo ? ' — demo data' : ''}`, 'success');
  const btn = $('#scan-start'); if (btn) { btn.disabled = false; $('#scan-stop').disabled = true; }
});
// Which sensors to poll. Fewer sensors = faster updates. Remembered per browser; defaults to the core gauges.
function loadPidSel(std) {
  let saved = null; try { saved = JSON.parse(localStorage.getItem('dos_pids') || 'null'); } catch (_) { /* storage blocked */ }
  return new Set(Array.isArray(saved) ? saved : std.filter((p) => p.gM).map((p) => p.pid));
}
function savePidSel(sel) { try { localStorage.setItem('dos_pids', JSON.stringify([...sel])); } catch (_) { /* ignore */ } }
async function renderPidPicker() {
  const box = $('#pid-pick'); if (!box) return;
  const std = (await api('/reference/pids')).filter((p) => p.verified && ELM327.DECODE[p.pid.slice(2)]);
  const sup = elm.connected && elm.supported.size ? elm.supported : null;
  const shown = sup ? std.filter((p) => sup.has(p.pid.slice(2))) : std;
  const sel = loadPidSel(std);
  box.innerHTML = `<div class="page-sub" style="margin-bottom:6px">${sup ? `${shown.length} sensors this car supports.` : 'Connect to see which sensors this car supports.'} Fewer sensors update faster; on CAN cars up to 6 are read per request.
      <button class="btn sm" type="button" data-act="pid-sel" data-arg="default">Core</button> <button class="btn sm" type="button" data-act="pid-sel" data-arg="all">All</button> <button class="btn sm" type="button" data-act="pid-sel" data-arg="none">None</button></div>
    <div class="pid-pick">${shown.map((p) => `<label class="chk"><input type="checkbox" data-pid="${p.pid}" ${sel.has(p.pid) ? 'checked' : ''}> ${esc(p.name)} <span style="color:var(--muted)">${esc(p.unit)}</span></label>`).join('')}</div>`;
  box.onchange = (e) => {
    const cb = e.target.closest('[data-pid]'); if (!cb) return;
    const cur = loadPidSel(std); cb.checked ? cur.add(cb.dataset.pid) : cur.delete(cb.dataset.pid); savePidSel(cur);
  };
  renderPidPicker.std = std;
}

// The adapter dropped out (loose plug, adapter reset): try to get it back a few times without losing the scan.
async function tryReconnect() {
  for (let i = 1; i <= 3 && live.running; i++) {
    setConn(`RECONNECTING ${i}/3…`, false); toast(`Adapter connection lost — reconnecting (${i}/3)…`, 'info');
    await new Promise((r) => setTimeout(r, 1500));
    if (live.running && await elm.reconnect()) { setConn('LIVE · ' + (elm.protocol || 'connected'), true); toast('Reconnected — the scan continues.', 'success'); return true; }
  }
  return false;
}

async function startLive(demo) {
  if (live.running) return;
  const pidsAll = await api('/reference/pids');
  const std = pidsAll.filter((p) => p.verified && ELM327.DECODE[p.pid.slice(2)]);
  const sel = loadPidSel(std);
  if (!demo) {
    if (!elm.connected) return toast('Connect the OBD2 adapter first.', 'error');
    const sup = elm.supported; // only poll PIDs the car says it supports
    const supported = std.filter((p) => sup.size === 0 || sup.has(p.pid.slice(2)));
    if (!supported.length) return toast('The vehicle reports no supported live PIDs.', 'error');
    live.pids = supported.filter((p) => sel.has(p.pid));
    if (!live.pids.length) return toast('None of the selected sensors are supported by this car. Pick some under Sensors.', 'error');
  } else {
    live.pids = std.filter((p) => sel.has(p.pid));
    if (!live.pids.length) return toast('Pick at least one sensor under Sensors.', 'error');
  }
  Object.assign(live, { running: true, demo, stats: {}, samples: [], started: Date.now(), blank: 0 });
  $('#scan-start').disabled = true; $('#scan-stop').disabled = false;
  const grid = $('#gauges');
  $('#chart-pid').innerHTML = live.pids.map((p) => `<option value="${p.pid}">${esc(p.name)} (${esc(p.unit)})</option>`).join('');
  grid.innerHTML = live.pids.map((p) => `<div class="gauge" id="g-${p.pid}"><div class="g-label">${esc(p.name)}</div><div class="g-value">—</div><div class="g-unit">${esc(p.unit)}</div><div class="g-bar"><div class="g-fill" style="width:0"></div></div></div>`).join('');
  const tick = async () => {
    if (!live.running) return;
    const sample = { t: Date.now() - live.started };
    let values;
    try {
      values = demo ? Object.fromEntries(live.pids.map((p) => [p.pid.slice(2), demoValue(p)])) : await elm.readPids(live.pids.map((p) => p.pid.slice(2)));
    } catch (e) {
      if (live.running && !demo && await tryReconnect()) { live.timer = setTimeout(tick, 50); return; }
      if (live.running) { live.running = false; toast('Adapter disconnected: ' + e.message, 'error'); setConn('CONNECT OBD2', false); }
      $('#scan-start').disabled = false; $('#scan-stop').disabled = true;
      return;
    }
    if (!live.running) return;
    let got = 0;
    for (const p of live.pids) {
      const v = values[p.pid.slice(2)];
      const g = $('#g-' + p.pid); if (!g) continue;
      if (v === null || v === undefined || Number.isNaN(v)) { g.querySelector('.g-value').textContent = 'n/a'; continue; }
      got++;
      const shown = Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2);
      g.classList.add('active'); g.querySelector('.g-value').textContent = shown;
      g.querySelector('.g-fill').style.width = Math.max(0, Math.min(100, ((v - p.min) / (p.max - p.min)) * 100)) + '%';
      const st = live.stats[p.pid] || (live.stats[p.pid] = { name: p.name, unit: p.unit, min: v, max: v, sum: 0, n: 0 });
      st.min = Math.min(st.min, v); st.max = Math.max(st.max, v); st.sum += v; st.n++;
      sample[p.pid] = +v.toFixed(2);
    }
    // Several rounds with no answer at all usually means the adapter hung: reset it.
    live.blank = got ? 0 : live.blank + 1;
    if (!demo && live.blank >= 3) { live.blank = 0; if (!(await tryReconnect())) { live.running = false; toast('The car stopped answering. Check the ignition and the adapter.', 'error'); setConn('CONNECT OBD2', false); } }
    live.samples.push(sample);
    drawLive();
    if (live.running) live.timer = setTimeout(tick, demo ? 400 : 50);
    else { $('#scan-start').disabled = false; $('#scan-stop').disabled = true; }
  };
  tick();
}
function demoValue(p) { // clearly-labelled simulated data: smooth drift inside each PID's range
  const t = Date.now() / 1000;
  return p.min + (p.max - p.min) * (0.35 + 0.15 * Math.sin(t / 3 + p.pid.charCodeAt(3)));
}

// ---------- views ----------
const views = {};

views.dashboard = async (el) => {
  const [s, b, jobs, parts, vehicles] = await Promise.all([api('/reports/summary'), loadBilling(), api('/jobs'), api('/parts'), api('/vehicles')]);
  renderBanner();
  const todayStr = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const open = jobs.filter((j) => j.status !== 'done');
  const dueSoon = vehicles.filter((v) => v.next_service_on && day(v.next_service_on) <= soon).sort((a, c) => String(a.next_service_on).localeCompare(String(c.next_service_on)));
  const low = parts.filter((p) => p.low_stock);
  el.innerHTML = page('Dashboard', esc(state.user.tenant.name), '<button class="btn primary" data-act="new-vehicle">+ New vehicle</button><button class="btn" data-act="job-new">+ New job</button><button class="btn success" data-act="nav" data-arg="scanner">⚡ Open scanner</button>',
    `<div class="stat-grid">${stat('blue', 'Open jobs', open.length, `${open.filter((j) => j.scheduled_for && String(j.scheduled_for).slice(0, 10) === todayStr).length} scheduled today`)}${stat('amber', 'Open fault codes', s.openDtcs)}${stat('green', 'Paid this month', money(s.revenueThisMonthCents), `${s.customers} customers · ${s.vehicles} vehicles`)}${stat('red', 'Outstanding', money(s.outstandingCents), `${s.overdueInvoices} overdue`)}</div>
     <div class="grid-2" style="margin-bottom:12px"><div class="card"><div class="card-title">Services due (next 14 days)</div>${table(['Vehicle', 'Owner', 'Due'], dueSoon.slice(0, 8).map((v) => `<tr><td>${esc(vehLabel(v))}</td><td>${esc(v.owner || '—')}</td><td>${day(v.next_service_on)}</td></tr>`), 'Nothing due. Set next-service dates on vehicles to see them here.')}</div>
     <div class="card"><div class="card-title">Low stock</div>${table(['Part', 'In stock'], low.slice(0, 8).map((p) => `<tr><td>${esc(p.name)}</td><td><span class="badge b-red">${p.qty}</span></td></tr>`), 'All parts above their warning level.')}</div></div>
     <div class="card"><div class="card-title">Plan usage</div>${usageBars(b)}</div>`);
};
function usageBars(b) {
  const bar = (label, used, limit, color) => `<div style="margin-bottom:12px"><div style="font-size:10px;color:var(--muted)">${label}</div><div style="font-family:var(--fm);font-size:15px;color:var(--${color})">${used}${limit ? ' / ' + limit : ' (unlimited)'}</div>${limit ? `<div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, used / limit * 100)}%;background:var(--${color})"></div></div>` : ''}</div>`;
  return bar('SCANS THIS MONTH', b.usage.scans, b.usage.scanLimit, 'accent') + bar('TEAM MEMBERS', b.usage.users, b.usage.userLimit, 'green');
}

views.scanner = async (el) => {
  const vehicles = await api('/vehicles');
  el.innerHTML = page('Live OBD2 scanner', 'Standard SAE J1979 Mode 01 PIDs from a real adapter', '',
    `<div class="card" style="margin-bottom:12px"><div class="card-title">Adapter</div>
      <div class="grid-4">
        <div class="field"><label>Protocol</label><select id="proto-sel">
          <option value="ATSP0">Auto-detect (recommended)</option><option value="ATSP6">ISO 15765 CAN 11-bit 500k</option><option value="ATSP7">ISO 15765 CAN 29-bit 500k</option>
          <option value="ATSP8">ISO 15765 CAN 11-bit 250k</option><option value="ATSP5">ISO 14230 KWP fast</option><option value="ATSP3">ISO 9141-2</option><option value="ATSP1">J1850 PWM</option><option value="ATSP2">J1850 VPW</option></select></div>
        <div class="field"><label>Baud rate</label><select id="baud-sel"><option>38400</option><option>9600</option><option>115200</option><option>500000</option></select></div>
        <div class="field"><label>Vehicle (to save the scan against)</label><select id="scan-vehicle">${vehOptions(vehicles)}</select></div>
        <div class="field"><label>&nbsp;</label><button class="btn primary" data-act="toggle-conn" style="width:100%">${elm.connected ? 'Disconnect' : 'Connect adapter'}</button></div>
      </div>
      ${elm.connected ? `<span class="badge b-green">${esc(elm.protocol)}</span>` : '<span class="badge b-amber">Not connected</span>'}
      <button class="btn sm" data-act="read-vin" style="margin-left:8px">Read VIN</button> <span id="vin-out" style="font-family:var(--fm);font-size:12px"></span>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="card-title">Sensors</div><div id="pid-pick"><div class="empty">Loading…</div></div></div>
    <div class="page-actions" style="margin-bottom:12px">
      <button class="btn success" id="scan-start" data-act="scan-start">▶ Start live scan</button>
      <button class="btn danger" id="scan-stop" data-act="scan-stop" disabled>■ Stop &amp; save</button>
      <button class="btn amber" data-act="scan-demo">Demo mode (simulated)</button>
      <button class="btn" data-act="scan-csv">↓ CSV</button>
    </div>
    <div id="demo-note"></div>
    <div class="card" style="margin-bottom:12px"><div class="card-title">Live graph <select id="chart-pid" style="font-size:12px"></select></div><canvas class="chart" id="live-chart"></canvas></div>
    <div class="card"><div class="card-title">Gauges <span id="scan-tag"></span></div><div class="gauge-grid" id="gauges"><div class="empty" style="grid-column:1/-1">Connect an adapter and start a scan. Only PIDs your car reports as supported are shown.</div></div></div>`);
  if (live.running) { $('#scan-start').disabled = true; $('#scan-stop').disabled = false; }
  renderPidPicker();
};

views.dtc = async (el) => {
  const [vehicles, events] = await Promise.all([api('/vehicles'), api('/dtc')]);
  const vmap = new Map(vehicles.map((v) => [v.id, v]));
  el.innerHTML = page('Fault codes', 'Read from the car, look up, clear, and keep the history', '',
    `<div class="card" style="margin-bottom:12px"><div class="card-title">Read from vehicle</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="dtc-vehicle" style="min-width:240px">${vehOptions(vehicles)}</select>
      <button class="btn primary" data-act="dtc-read">⟳ Read stored + pending</button>
      <button class="btn" data-act="readiness">Readiness &amp; MIL</button><button class="btn" data-act="freeze">Freeze frame</button><button class="btn" data-act="mode06">Monitor tests (Mode 06)</button>
      <button class="btn danger" data-act="dtc-clear">✕ Clear codes</button></div><div id="dtc-extra"></div>
      <div class="annotation" style="margin-top:10px">Reading codes saves the result to the vehicle's history; it does not count toward your monthly live-scan limit. Clearing codes also resets readiness monitors — the car will not pass an emissions check until it has driven through its drive cycle.</div>
      <div id="dtc-live"></div></div>
    <div class="card"><div class="card-title">History</div>${table(['Date', 'Vehicle', 'Code', 'Description', 'Severity', 'Status'],
      events.map((e) => `<tr><td>${day(e.created_at)}</td><td>${esc(vehLabel(vmap.get(e.vehicle_id)))}</td><td><b>${esc(e.code)}</b></td><td>${esc(e.info.name)}</td><td>${sevBadge(e.info.sev)}</td><td><span class="badge ${e.status === 'cleared' ? 'b-green' : 'b-amber'}">${esc(e.status)}</span></td></tr>`))}</div>`);
};
const sevBadge = (s) => `<span class="badge ${s === 'critical' ? 'b-red' : s === 'warning' ? 'b-amber' : s === 'advisory' ? 'b-blue' : 'b-purple'}">${esc(s === 'unknown' ? 'look up' : s)}</span>`;

views.terminal = async (el) => {
  el.innerHTML = page('Serial terminal', 'Raw ELM327 AT and OBD commands', '<button class="btn" data-act="term-save">⬇ Save log</button><button class="btn" data-act="term-clear">✕ Clear</button>',
    `<div class="annotation">Sends exactly what you type to the adapter. Mode 04 clears codes; commands beginning 2x / manufacturer services are not validated by this app.</div>
     <div class="card"><div class="terminal" id="terminal"></div>
     <form class="term-row" data-form="term"><input class="term-input" name="cmd" placeholder="ATZ, ATSP0, 0100, 010C, 03 …" autocomplete="off"><button class="btn primary" type="submit">Send</button></form></div>`);
  termLog.forEach(([d, t]) => appendTerm(d, t));
};

views.pidref = async (el) => {
  const pids = await api('/reference/pids');
  el.innerHTML = page('PID reference', 'Verified = standard SAE J1979, decodable on any OBD2 car. Others are unverified placeholders and are never polled.', '',
    `<div class="card">${table(['PID', 'Name', 'Formula', 'Unit', 'Range', 'Status'], pids.map((p) => `<tr><td style="font-family:var(--fm)">${esc(p.pid)}</td><td>${esc(p.name)}</td><td style="font-family:var(--fm)">${esc(p.formula)}</td><td>${esc(p.unit)}</td><td>${p.min} … ${p.max}</td><td>${p.verified ? '<span class="badge b-green">verified</span>' : '<span class="badge b-amber">unverified</span>'}</td></tr>`))}</div>`);
};

views.customers = async (el) => {
  const rows = await api('/customers');
  el.innerHTML = page('Customers', `${rows.length} on file`, '<button class="btn primary" data-act="cust-new">+ Add customer</button>',
    `<div class="card">${table(['Name', 'Phone', 'Email', 'Vehicles', 'Total spend', 'Balance', 'Status', ''], rows.map((c) => `<tr><td>${esc(fullName(c))}</td><td>${esc(c.phone || '—')}</td><td>${esc(c.email || '—')}</td><td>${c.vehicle_count}</td><td>${money(c.spend_cents)}</td><td>${c.balance_cents ? `<span style="color:var(--amber)">${money(c.balance_cents)}</span>` : '—'}</td><td><span class="badge b-blue">${esc(c.status)}</span></td>
      <td class="row-actions"><button class="btn sm" data-act="cust-edit" data-arg="${c.id}">Edit</button><button class="btn sm danger" data-act="cust-del" data-arg="${c.id}">Delete</button></td></tr>`), 'No customers yet. Add your first one.')}</div>`);
  views.customers.rows = rows;
};
const custForm = (c = {}) => `<div class="form-grid"><div class="field"><label>First name</label><input name="first_name" value="${esc(c.first_name)}" required></div><div class="field"><label>Last name</label><input name="last_name" value="${esc(c.last_name)}"></div>
  <div class="field"><label>Email</label><input type="email" name="email" value="${esc(c.email)}"></div><div class="field"><label>Phone</label><input name="phone" value="${esc(c.phone)}"></div>
  <div class="field"><label>Status</label><select name="status">${['new', 'regular', 'vip'].map((s) => `<option${c.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
  <div class="field form-full"><label>Notes</label><textarea name="notes" rows="2">${esc(c.notes)}</textarea></div></div>`;

views.vehicles = async (el) => {
  const rows = await api('/vehicles');
  el.innerHTML = page('Vehicles', `${rows.length} in your database`, '<button class="btn primary" data-act="new-vehicle">+ Add vehicle</button>',
    `<div class="card">${table(['Plate', 'Vehicle', 'Engine', 'VIN', 'Owner', 'Mileage', 'Next service', 'Open codes', ''], rows.map((v) => `<tr><td>${esc(v.plate || '—')}</td><td>${esc(v.make + ' ' + v.model + (v.year ? ' ' + v.year : ''))}</td><td>${esc(v.engine || '—')}</td><td style="font-family:var(--fm);font-size:11px">${esc(v.vin || '—')}</td><td>${esc(v.owner || '—')}</td><td>${v.mileage_km != null ? v.mileage_km.toLocaleString('en-ZA') + ' km' : '—'}</td><td>${v.next_service_on ? day(v.next_service_on) : '—'}</td><td>${v.open_dtcs ? `<span class="badge b-amber">${v.open_dtcs}</span>` : '—'}</td>
      <td class="row-actions"><button class="btn sm" data-act="report" data-arg="${v.id}">History</button><button class="btn sm" data-act="veh-edit" data-arg="${v.id}">Edit</button><button class="btn sm danger" data-act="veh-del" data-arg="${v.id}">Delete</button></td></tr>`), 'No vehicles yet.')}</div>`);
  views.vehicles.rows = rows;
};
async function vehicleForm(v = {}) {
  const [custs, cars] = await Promise.all([api('/customers'), api('/reference/cars')]);
  const makes = Object.keys(cars).sort();
  const html = `<div class="form-grid">
    <div class="field"><label>Make</label><input name="make" list="makes" value="${esc(v.make)}" required><datalist id="makes">${makes.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
    <div class="field"><label>Model</label><input name="model" list="models" value="${esc(v.model)}" required><datalist id="models"></datalist></div>
    <div class="field"><label>Year</label><input name="year" type="number" value="${esc(v.year)}"></div><div class="field"><label>Engine</label><input name="engine" value="${esc(v.engine)}" placeholder="e.g. 1.0 TSI"></div>
    <div class="field"><label>Registration</label><input name="plate" value="${esc(v.plate)}"></div><div class="field"><label>VIN</label><input name="vin" value="${esc(v.vin)}" maxlength="17"></div>
    <div class="field"><label>Colour</label><input name="colour" value="${esc(v.colour)}"></div><div class="field"><label>Mileage (km)</label><input name="mileage_km" type="number" value="${esc(v.mileage_km)}"></div>
    <div class="field"><label>Next service date</label><input name="next_service_on" type="date" value="${esc(day(v.next_service_on) === '—' ? '' : day(v.next_service_on))}"></div><div class="field"><label>Next service at (km)</label><input name="next_service_km" type="number" value="${esc(v.next_service_km)}"></div>
    <div class="field form-full"><label>Owner</label><select name="customer_id">${custOptions(custs, v.customer_id)}</select></div></div>`;
  return { html, cars };
}
function wireModels(cars) {
  const mk = $('#modal-form [name=make]'); const dl = $('#models');
  const fill = () => { dl.innerHTML = (cars[mk.value] || []).map((m) => `<option value="${esc(m)}">`).join(''); };
  mk.addEventListener('input', fill); fill();
}
const clean = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = v === '' ? null : v; return r; };

views.tuning = async (el) => {
  const rows = await api('/remaps');
  el.innerHTML = page('Remap log', 'Record every tune: ECU, stage, and power before/after', '<button class="btn primary" data-act="remap-new">+ Log remap</button>',
    `<div class="card">${table(['Date', 'Vehicle', 'ECU', 'Stage', 'Before', 'After', 'Gain', 'Tuner', 'Notes', ''], rows.map((r) => {
      const gain = r.power_before_kw != null && r.power_after_kw != null ? r.power_after_kw - r.power_before_kw : null;
      return `<tr><td>${day(r.done_on)}</td><td>${esc(r.vehicle ? r.vehicle.make + ' ' + r.vehicle.model : '—')}</td><td>${esc(r.ecu || '—')}</td><td>${esc(r.stage || '—')}</td><td>${r.power_before_kw ?? '—'} kW</td><td>${r.power_after_kw ?? '—'} kW</td><td>${gain != null ? `<span class="badge ${gain >= 0 ? 'b-green' : 'b-red'}">${gain >= 0 ? '+' : ''}${gain} kW</span>` : '—'}</td><td>${esc(r.tuner || '—')}</td><td>${esc(r.notes || '')}</td><td><button class="btn sm danger" data-act="remap-del" data-arg="${r.id}">Delete</button></td></tr>`;
    }), 'No remaps logged yet.')}</div>`);
};

views.inspections = async (el) => {
  const rows = await api('/inspections');
  el.innerHTML = page('Inspections', 'Checklists with technician sign-off', '<button class="btn primary" data-act="insp-new">+ New inspection</button>',
    `<div class="card">${table(['Date', 'Vehicle', 'Type', 'Checked', 'Status', ''], rows.map((i) => {
      const items = i.items || {}; const total = Object.keys(items).length; const ok = Object.values(items).filter(Boolean).length;
      return `<tr><td>${day(i.created_at)}</td><td>${esc(i.vehicle ? vehLabel(i.vehicle) : '—')}</td><td>${esc(i.type)}</td><td>${ok}/${total}</td><td><span class="badge ${i.status === 'signed_off' ? 'b-green' : 'b-amber'}">${esc(i.status.replace('_', ' '))}</span></td>
      <td class="row-actions"><button class="btn sm" data-act="insp-view" data-arg="${i.id}">Photos</button>${i.status !== 'signed_off' ? `<button class="btn sm success" data-act="insp-sign" data-arg="${i.id}">Sign off</button>` : ''}<button class="btn sm danger" data-act="insp-del" data-arg="${i.id}">Delete</button></td></tr>`;
    }), 'No inspections yet.')}</div>`);
};

views.invoices = async (el) => {
  const [rows, custs, vehs] = await Promise.all([api('/invoices'), api('/customers'), api('/vehicles')]);
  const cm = new Map(custs.map((c) => [c.id, c])), vm = new Map(vehs.map((v) => [v.id, v]));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.total_cents, 0);
  const inv = (r) => r.kind === 'invoice';
  views.invoices.rows = rows;
  el.innerHTML = page('Invoices & quotes', 'Numbered per workshop · amounts in ZAR', '<button class="btn primary" data-act="inv-new" data-arg="invoice">+ Invoice</button><button class="btn" data-act="inv-new" data-arg="quote">+ Quote</button>',
    `<div class="stat-grid">${stat('green', 'Paid', money(sum((r) => inv(r) && r.status === 'paid')))}${stat('amber', 'Outstanding', money(sum((r) => inv(r) && r.status === 'outstanding')))}${stat('red', 'Overdue', money(sum((r) => inv(r) && r.status === 'overdue')))}${stat('blue', 'Open quotes', money(sum((r) => r.kind === 'quote' && r.status === 'draft')))}</div>
     <div class="card">${table(['#', 'Type', 'Customer', 'Vehicle', 'Date', 'Due', 'Amount', 'Status', ''], rows.map((r) => `<tr><td>${r.kind === 'quote' ? 'Q' : 'INV'}-${String(r.number).padStart(4, '0')}</td><td>${r.kind}</td><td>${esc(fullName(cm.get(r.customer_id)))}</td><td>${esc(vm.get(r.vehicle_id) ? vehLabel(vm.get(r.vehicle_id)) : '—')}</td><td>${day(r.issued_on)}</td><td>${day(r.due_on)}</td><td>${money(r.total_cents)}</td><td><span class="badge ${r.status === 'paid' || r.status === 'accepted' ? 'b-green' : r.status === 'overdue' ? 'b-red' : 'b-amber'}">${esc(r.status)}</span></td>
       <td class="row-actions"><button class="btn sm" data-act="inv-print" data-arg="${r.id}">View</button><button class="btn sm" data-act="inv-pdf" data-arg="${r.id}">PDF</button><button class="btn sm" data-act="inv-email" data-arg="${r.id}">Email</button>${inv(r) && r.status !== 'paid' ? `<button class="btn sm" data-act="inv-link" data-arg="${r.id}">Pay link</button>` : ''}${inv(r) && r.status !== 'paid' ? `<button class="btn sm success" data-act="inv-paid" data-arg="${r.id}">Mark paid</button>` : ''}${r.kind === 'quote' && r.status === 'draft' ? `<button class="btn sm" data-act="inv-convert" data-arg="${r.id}">→ Invoice</button>` : ''}<button class="btn sm danger" data-act="inv-del" data-arg="${r.id}">Delete</button></td></tr>`), 'No invoices or quotes yet.')}</div>`);
  views.invoices.ctx = { cm, vm };
};
function lineRow(i = {}) {
  return `<div class="line-row"${i.part_id ? ` data-part="${i.part_id}"` : ''}><input name="desc" placeholder="Description" value="${esc(i.description)}"><input name="qty" type="number" min="1" value="${i.qty || 1}"><input name="price" type="number" step="0.01" min="0" placeholder="Unit price (R)" value="${i.unit_cents != null ? (i.unit_cents / 100).toFixed(2) : ''}"><button class="btn sm danger" type="button" data-act="line-del">×</button></div>`;
}
const readLines = () => [...document.querySelectorAll('#lines .line-row')].map((r) => ({
  description: r.querySelector('[name=desc]').value, qty: Number(r.querySelector('[name=qty]').value || 1), unit_cents: Math.round(Number(r.querySelector('[name=price]').value || 0) * 100), ...(r.dataset.part ? { part_id: Number(r.dataset.part) } : {}),
})).filter((l) => l.description.trim());

views.reports = async (el) => {
  const vehicles = await api('/vehicles');
  el.innerHTML = page('Vehicle report', 'Complete history for a customer: scans, fault codes, remaps, inspections, invoices', '<button class="btn" data-act="report-pdf">⬇ PDF</button><button class="btn" data-act="print">🖨 Print</button>',
    `<div class="card no-print" style="margin-bottom:12px"><select id="rep-vehicle" style="min-width:300px">${vehOptions(vehicles)}</select> <button class="btn primary" data-act="report-go">Generate</button></div><div id="report-out"></div>`);
};
async function renderReport(id) {
  const r = await api('/reports/vehicle/' + id);
  const v = r.vehicle;
  $('#report-out').innerHTML = `<div class="doc"><h2>${esc(state.user.tenant.name)}</h2><div class="muted">Vehicle report · ${new Date().toLocaleDateString('en-ZA')}</div>
    <h3 style="margin-top:14px">${esc(vehLabel(v))}</h3><div class="muted">VIN ${esc(v.vin || '—')} · ${esc(v.engine || '')} · ${v.mileage_km != null ? v.mileage_km.toLocaleString('en-ZA') + ' km' : ''} · Owner: ${esc(fullName(r.customer))}</div>
    <h3 style="margin-top:14px">Fault codes</h3>${table(['Date', 'Code', 'Description', 'Status'], r.dtcs.map((d) => `<tr><td>${day(d.created_at)}</td><td>${esc(d.code)}</td><td>${esc(d.info.name)}</td><td>${esc(d.status)}</td></tr>`), 'None recorded.')}
    <h3 style="margin-top:14px">Remaps</h3>${table(['Date', 'ECU', 'Stage', 'Before → after (kW)'], r.remaps.map((m) => `<tr><td>${day(m.done_on)}</td><td>${esc(m.ecu || '—')}</td><td>${esc(m.stage || '—')}</td><td>${m.power_before_kw ?? '—'} → ${m.power_after_kw ?? '—'}</td></tr>`), 'None recorded.')}
    <h3 style="margin-top:14px">Inspections</h3>${table(['Date', 'Type', 'Status'], r.inspections.map((i) => `<tr><td>${day(i.created_at)}</td><td>${esc(i.type)}</td><td>${esc(i.status)}</td></tr>`), 'None recorded.')}
    <h3 style="margin-top:14px">Invoices</h3>${table(['#', 'Date', 'Amount', 'Status'], r.invoices.map((i) => `<tr><td>${i.number}</td><td>${day(i.issued_on)}</td><td>${money(i.total_cents)}</td><td>${esc(i.status)}</td></tr>`), 'None recorded.')}
    <h3 style="margin-top:14px">Scans</h3>${table(['Date', 'Protocol', 'Source'], r.scans.map((s) => `<tr><td>${day(s.started_at)}</td><td>${esc(s.protocol || '—')}</td><td>${esc(s.source)}</td></tr>`), 'None recorded.')}</div>`;
}

views.team = async (el) => {
  if (state.user.role !== 'admin') { el.innerHTML = page('Team', '', '', '<div class="empty">Only admins can manage the team.</div>'); return; }
  const rows = await api('/users'); const b = state.billing;
  el.innerHTML = page('Team', `${rows.length}${b.usage.userLimit ? ' of ' + b.usage.userLimit : ''} seats used`, '<button class="btn primary" data-act="user-new">+ Add team member</button>',
    `<div class="card">${table(['Name', 'Email', 'Role', ''], rows.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="badge b-blue">${esc(u.role)}</span></td><td class="row-actions">${u.id === state.user.id ? '' : `<button class="btn sm danger" data-act="user-del" data-arg="${u.id}">Remove</button>`}</td></tr>`))}</div>`);
};

views.billing = async (el) => {
  const b = await loadBilling(); renderBanner();
  el.innerHTML = page('Subscription & billing', 'Plans are billed monthly in ZAR through PayFast', '',
    `<div class="card" style="margin-bottom:14px"><div class="card-title">Current plan</div><div style="font-family:var(--fd);font-size:20px;font-weight:700;text-transform:capitalize">${esc(b.plan)} <span class="badge ${b.active ? 'b-green' : 'b-red'}">${esc(b.planStatus)}</span></div>
      ${b.planStatus === 'trial' ? `<div class="page-sub">Trial ends ${day(b.trialEndsAt)}</div>` : ''}<div style="margin-top:12px">${usageBars(b)}</div></div>
     <div class="plan-grid">${b.plans.map((p) => `<div class="plan-card${p.key === 'pro' ? ' featured' : ''}"><div class="plan-name">${esc(p.name)}</div><div class="plan-price-big"><sup>R</sup>${(p.priceCents / 100).toLocaleString('en-ZA')}<span>/mo</span></div>
       <div class="plan-feature">${p.scansPerMonth ? p.scansPerMonth + ' live scans / month' : 'Unlimited scans'}</div><div class="plan-feature">${p.users ? p.users + ' team members' : 'Unlimited team members'}</div><div class="plan-feature">All diagnostics, CRM, invoicing</div>
       ${state.user.role === 'admin' ? (p.key === b.plan && b.planStatus === 'active' ? '<button class="btn" style="width:100%;margin-top:12px" disabled>Current plan</button>' : `<button class="btn primary" style="width:100%;margin-top:12px" data-act="subscribe" data-arg="${p.key}">${b.paymentsEnabled ? 'Subscribe' : 'Payments not configured'}</button>`) : ''}
       ${b.devPlanSwitch && state.user.role === 'admin' ? `<button class="btn sm" style="width:100%;margin-top:6px" data-act="dev-switch" data-arg="${p.key}">Dev: switch without paying</button>` : ''}</div>`).join('')}</div>`);
};

// ---------- actions ----------
const actions = {
  'auth-tab': (a) => { for (const f of ['login', 'register', 'forgot', 'reset']) $('#auth-' + f).style.display = a === f ? '' : 'none'; document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.arg === a)); },
  nav: (a) => go(a), logout, 'close-modal': closeModal, print: () => window.print(),
  'toggle-conn': () => (elm.connected ? disconnect().then(() => state.page === 'scanner' && go('scanner')) : connect()),
  'scan-start': () => startLive(false), 'scan-demo': async () => { $('#demo-note').innerHTML = '<div class="annotation">DEMO MODE — these values are simulated and do not come from a vehicle. They are saved as demo data and do not count toward your scan limit.</div>'; $('#scan-tag').innerHTML = '<span class="demo-tag">SIMULATED</span>'; startLive(true); },
  'scan-stop': () => stopLive(true),
  'scan-csv': () => {
    if (!live.samples.length) return toast('Run a scan first.', 'error');
    const cols = Object.keys(live.stats); const head = ['t_ms', ...cols.map((k) => `${live.stats[k].name} (${live.stats[k].unit})`)];
    const csv = [head.join(','), ...live.samples.map((s) => [s.t, ...cols.map((k) => s[k] ?? '')].join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'scan.csv'; a.click();
  },
  'read-vin': guard(async () => { if (!elm.connected) return toast('Connect the adapter first.', 'error'); const v = await elm.readVin(); $('#vin-out').textContent = v || 'VIN not available from this car'; }),
  'dtc-read': guard(async () => {
    if (!elm.connected) return toast('Connect the adapter first.', 'error');
    const vid = Number($('#dtc-vehicle').value) || null;
    const [stored, pending] = [await elm.readStoredDtcs(), await elm.readPendingDtcs()];
    const all = [...stored.map((code) => ({ code, status: 'active' })), ...pending.filter((c) => !stored.includes(c)).map((code) => ({ code, status: 'pending' }))];
    const infos = await Promise.all(all.map((d) => api('/reference/dtc/' + d.code)));
    $('#dtc-live').innerHTML = all.length ? `<div style="margin-top:12px">${table(['Code', 'Type', 'Description', 'Likely cause', 'Tip', 'Severity'], all.map((d, i) => `<tr><td><b>${d.code}</b></td><td>${d.status}</td><td>${esc(infos[i].name)}</td><td>${esc(infos[i].cause)}</td><td>${esc(infos[i].tip)}</td><td>${sevBadge(infos[i].sev)}</td></tr>`))}</div>` : '<div class="empty">No stored or pending trouble codes.</div>';
    if (vid) { await api('/scans', { method: 'POST', body: { vehicle_id: vid, protocol: elm.protocol, source: 'adapter', dtcs: all, ...(state.lastReadiness ? { readiness: state.lastReadiness } : {}), ...(state.lastFreeze ? { freeze_frame: state.lastFreeze } : {}) } }); toast('Result saved to the vehicle history.', 'success'); } else toast('Select a vehicle to save the result to its history.', 'info');
  }),
  'dtc-clear': guard(async () => {
    if (!elm.connected) return toast('Connect the adapter first.', 'error');
    const vid = Number($('#dtc-vehicle').value); if (!vid) return toast('Select the vehicle first.', 'error');
    if (!confirm('Clear all trouble codes? This also resets readiness monitors and erases freeze-frame data. Make sure you have recorded the codes first.')) return;
    if (!(await elm.clearDtcs())) return toast('The car did not confirm the clear.', 'error');
    await api('/dtc/clear', { method: 'POST', body: { vehicle_id: vid } }); toast('Codes cleared.', 'success'); go('dtc');
  }),
  'term-clear': () => { termLog.length = 0; $('#terminal').innerHTML = ''; },
  'cust-new': () => openModal('Add customer', custForm(), guard(async (f) => { await api('/customers', { method: 'POST', body: clean(f) }); closeModal(); go('customers'); })),
  'cust-edit': (id) => { const c = views.customers.rows.find((x) => x.id === Number(id)); openModal('Edit customer', custForm(c), guard(async (f) => { await api('/customers/' + id, { method: 'PATCH', body: clean(f) }); closeModal(); go('customers'); })); },
  'cust-del': guard(async (id) => { if (confirm('Delete this customer? Their vehicles stay but lose the owner link.')) { await api('/customers/' + id, { method: 'DELETE' }); go('customers'); } }),
  'new-vehicle': guard(async () => { const { html, cars } = await vehicleForm(); openModal('Add vehicle', html, guard(async (f) => { await api('/vehicles', { method: 'POST', body: clean(f) }); closeModal(); go('vehicles'); })); wireModels(cars); }),
  'veh-edit': guard(async (id) => { const v = views.vehicles.rows.find((x) => x.id === Number(id)); const { html, cars } = await vehicleForm(v); openModal('Edit vehicle', html, guard(async (f) => { await api('/vehicles/' + id, { method: 'PATCH', body: clean(f) }); closeModal(); go('vehicles'); })); wireModels(cars); }),
  'veh-del': guard(async (id) => { if (confirm('Delete this vehicle and its fault-code history?')) { await api('/vehicles/' + id, { method: 'DELETE' }); go('vehicles'); } }),
  report: async (id) => { await go('reports'); $('#rep-vehicle').value = id; renderReport(id).catch((e) => toast(e.message, 'error')); },
  'report-go': guard(async () => { const id = $('#rep-vehicle').value; if (!id) return toast('Select a vehicle.', 'error'); await renderReport(id); }),
  'remap-new': guard(async () => {
    const vs = await api('/vehicles');
    openModal('Log remap', `<div class="form-grid"><div class="field form-full"><label>Vehicle</label><select name="vehicle_id" required>${vehOptions(vs)}</select></div><div class="field"><label>ECU</label><input name="ecu"></div><div class="field"><label>Stage</label><input name="stage" placeholder="Stage 1"></div>
      <div class="field"><label>Power before (kW)</label><input name="power_before_kw" type="number"></div><div class="field"><label>Power after (kW)</label><input name="power_after_kw" type="number"></div><div class="field"><label>Tuner</label><input name="tuner"></div><div class="field"><label>Date</label><input name="done_on" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field form-full"><label>Notes</label><textarea name="notes" rows="2"></textarea></div></div>`, guard(async (f) => { await api('/remaps', { method: 'POST', body: clean(f) }); closeModal(); go('tuning'); }));
  }),
  'remap-del': guard(async (id) => { if (confirm('Delete this entry?')) { await api('/remaps/' + id, { method: 'DELETE' }); go('tuning'); } }),
  'insp-new': guard(async () => {
    const [vs, items] = await Promise.all([api('/vehicles'), api('/reference/inspection-items')]);
    openModal('New inspection', `<div class="form-grid"><div class="field"><label>Vehicle</label><select name="vehicle_id" required>${vehOptions(vs)}</select></div><div class="field"><label>Type</label><select name="type"><option value="service">Service check</option><option value="pre-purchase">Pre-purchase</option><option value="roadworthy">Roadworthy</option><option value="tuning">Tuning pre-check</option></select></div></div>
      <div style="max-height:260px;overflow:auto;margin:8px 0">${items.map((i, n) => `<label class="chk"><input type="checkbox" data-item="${n}"> ${esc(i)}</label>`).join('')}</div><div class="field"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>`,
    guard(async (f) => { const map = {}; document.querySelectorAll('[data-item]').forEach((c) => { map[items[c.dataset.item]] = c.checked; }); await api('/inspections', { method: 'POST', body: { ...clean(f), items: map } }); closeModal(); go('inspections'); }));
  }),
  'insp-sign': guard(async (id) => { await api(`/inspections/${id}/sign-off`, { method: 'POST' }); go('inspections'); }),
  'insp-del': guard(async (id) => { if (confirm('Delete this inspection?')) { await api('/inspections/' + id, { method: 'DELETE' }); go('inspections'); } }),
  'inv-new': guard(async (kind) => {
    const [cs, vs, parts] = await Promise.all([api('/customers'), api('/vehicles'), api('/parts')]); views.invoices.parts = parts;
    openModal(kind === 'quote' ? 'New quote' : 'New invoice', `<div class="form-grid"><div class="field"><label>Customer</label><select name="customer_id">${custOptions(cs)}</select></div><div class="field"><label>Vehicle</label><select name="vehicle_id">${vehOptions(vs)}</select></div>${kind === 'invoice' ? '<div class="field"><label>Due date</label><input type="date" name="due_on"></div>' : ''}</div>
      ${kind === 'invoice' && parts.length ? `<div class="field"><label>Add a part from stock</label><select id="part-pick"><option value="">— choose —</option>${parts.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.qty} in stock)</option>`).join('')}</select></div>` : ''}<label style="font-size:12px;color:var(--muted2)">Line items</label><div id="lines">${lineRow()}</div><button class="btn sm" type="button" data-act="line-add">+ Add line</button>`,
    guard(async (f) => { await api('/invoices', { method: 'POST', body: { ...clean(f), kind, items: readLines() } }); closeModal(); go('invoices'); }));
  }),
  'line-add': () => $('#lines').insertAdjacentHTML('beforeend', lineRow()),
  'line-del': (_a, el) => { if (document.querySelectorAll('#lines .line-row').length > 1) el.closest('.line-row').remove(); },
  'inv-paid': guard(async (id) => { await api('/invoices/' + id, { method: 'PATCH', body: { status: 'paid' } }); go('invoices'); }),
  'inv-convert': guard(async (id) => { await api(`/invoices/${id}/convert`, { method: 'POST' }); toast('Invoice created from quote.', 'success'); go('invoices'); }),
  'inv-del': guard(async (id) => { if (confirm('Delete this document?')) { await api('/invoices/' + id, { method: 'DELETE' }); go('invoices'); } }),
  'inv-print': (id) => {
    const r = views.invoices.rows.find((x) => x.id === Number(id)); const { cm, vm } = views.invoices.ctx;
    openModal(`${r.kind === 'quote' ? 'Quote' : 'Invoice'} ${String(r.number).padStart(4, '0')}`, `<div class="doc"><h2>${esc(state.user.tenant.name)}</h2><div class="muted">${r.kind.toUpperCase()} · ${day(r.issued_on)}${r.due_on ? ' · due ' + day(r.due_on) : ''}</div>
      <p style="margin-top:8px">Customer: ${esc(fullName(cm.get(r.customer_id)))}<br>Vehicle: ${esc(vm.get(r.vehicle_id) ? vehLabel(vm.get(r.vehicle_id)) : '—')}</p>
      <table><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr>${r.items.map((i) => `<tr><td>${esc(i.description)}</td><td>${i.qty}</td><td>${money(i.unit_cents)}</td><td>${money(i.qty * i.unit_cents)}</td></tr>`).join('')}</table>
      <h3 style="text-align:right">Total ${money(r.total_cents)}</h3></div>`, async () => { window.print(); }, 'Print');
  },
  'user-new': () => openModal('Add team member', `<div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input type="email" name="email" required></div><div class="field"><label>Temporary password</label><input type="password" name="password" minlength="8" required></div><div class="field"><label>Role</label><select name="role"><option value="technician">Technician</option><option value="admin">Admin</option></select></div>`,
    guard(async (f) => { await api('/users', { method: 'POST', body: f }); closeModal(); go('team'); })),
  'user-del': guard(async (id) => { if (confirm('Remove this team member?')) { await api('/users/' + id, { method: 'DELETE' }); go('team'); } }),
  subscribe: guard(async (plan) => {
    const c = await api('/billing/checkout', { method: 'POST', body: { plan } });
    const f = document.createElement('form'); f.method = 'POST'; f.action = c.action;
    for (const [k, v] of Object.entries(c.fields)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
    document.body.appendChild(f); f.submit();
  }),
  'dev-switch': guard(async (plan) => { await api('/billing/dev-switch', { method: 'POST', body: { plan } }); await loadBilling(); renderBanner(); go('billing'); }),
};


// ============ v2 features: charts, readiness, jobs, stock, photos, settings, audit ============
async function apiBlob(path) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { let m = 'Download failed'; try { m = (await r.json()).error || m; } catch (_) { /* not json */ } throw new Error(m); }
  return r.blob();
}
function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
function readFileAsImage(file) { return new Promise((res, rej) => { const img = new Image(); const u = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(u); res(img); }; img.onerror = () => rej(new Error('Could not read that image')); img.src = u; }); }
async function resizeToDataUrl(file, maxSide, type, quality) {
  const img = await readFileAsImage(file);
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL(type, quality);
}

// ----- chart -----
const COLORS = ['#60A5FA', '#10B981', '#F59E0B', '#EF4444'];
// x defaults to time in ms from 0; pass { xUnit: 'rpm' } to plot against another quantity from its own minimum.
function drawChart(canvas, series, unit, opts = {}) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1; const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const pts = series.flatMap((s) => s.points);
  g.font = '11px JetBrains Mono, monospace';
  if (pts.length < 2) { g.fillStyle = '#64748B'; g.fillText('No data to graph yet', 14, 24); return; }
  const L = 46, R = 12, T = 22, B = 22;
  let minV = Math.min(...pts.map((p) => p.v)), maxV = Math.max(...pts.map((p) => p.v)); if (minV === maxV) { minV -= 1; maxV += 1; }
  const maxT = Math.max(...pts.map((p) => p.t)) || 1; const minT = opts.xUnit ? Math.min(...pts.map((p) => p.t)) : 0;
  const X = (t) => L + ((t - minT) / (maxT - minT || 1)) * (w - L - R), Y = (v) => T + (1 - (v - minV) / (maxV - minV)) * (h - T - B);
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#64748B'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = minV + ((maxV - minV) * i) / 4, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1), 4, y + 3); }
  if (opts.xUnit) { g.fillText(`${Math.round(maxT)} ${opts.xUnit}`, w - R - 70, h - 6); g.fillText(`${Math.round(minT)}`, L, h - 6); }
  else { g.fillText(`${(maxT / 1000).toFixed(0)} s`, w - R - 34, h - 6); g.fillText('0', L, h - 6); }
  series.forEach((s, n) => {
    g.strokeStyle = COLORS[n % COLORS.length]; g.lineWidth = 1.6; g.beginPath();
    s.points.forEach((p, i) => (i ? g.lineTo(X(p.t), Y(p.v)) : g.moveTo(X(p.t), Y(p.v)))); g.stroke();
    g.fillStyle = COLORS[n % COLORS.length]; g.fillText(`■ ${s.label}${unit ? ' (' + unit + ')' : ''}`, L + n * 190, 12);
  });
}
function drawLive() {
  const sel = $('#chart-pid'); if (!sel || !sel.value) return;
  const p = live.pids.find((x) => x.pid === sel.value);
  drawChart($('#live-chart'), [{ label: p ? p.name : sel.value, points: live.samples.filter((s) => s[sel.value] !== undefined).map((s) => ({ t: s.t, v: s[sel.value] })) }], p && p.unit);
}

// ----- tuning: learned engine profiles, ECU software, pulls -----
const PULL_PIDS = ['0C', '0D', '0B', '33', '10', '0E', '0F', '04', '11', '49', '44', '06', '05'];
const pull = { armed: false, recording: false, running: false, samples: [], stats: {}, started: 0, low: 0, vid: null, pids: [] };
const fmt = (v) => (v == null ? '—' : Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(2));
const statusBadge = (st) => ({ normal: '<span class="badge b-green">normal</span>', high: '<span class="badge b-red">high for this engine</span>', low: '<span class="badge b-amber">low for this engine</span>', learning: '<span class="badge b-blue">learning</span>' }[st] || '');

views.tune = async (el) => {
  const [vehicles, lib] = await Promise.all([api('/vehicles'), api('/tuning/engines')]);
  el.innerHTML = page('Tuning', 'Learns every engine you scan: what is normal for it, which ECU software it runs, and what a tune changed', '<button class="btn" data-act="nav" data-arg="tuning">📈 Remap log</button>',
    `<div class="card" style="margin-bottom:12px"><div class="card-title">Vehicle</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><select id="tune-vehicle" style="min-width:260px">${vehOptions(vehicles)}</select>
      <button class="btn" data-act="tune-ecu">⬇ Read ECU software</button><button class="btn amber" data-act="pull-arm">🏁 Record a pull</button></div>
      <div id="pull-box"></div></div>
    <div id="tune-body"><div class="empty">Pick a vehicle to see its tuning picture.</div></div>
    <div class="card" style="margin-top:12px"><div class="card-title">Engine library <span class="badge ${lib.shared ? 'b-green' : 'b-blue'}">${lib.shared ? 'shared learning on' : 'this workshop only'}</span></div>
      <div class="page-sub" style="margin-bottom:8px">Every engine the system has learned from your scans${lib.shared ? ' and the shared pool' : ''}. An engine is "learned" after ${5} scans from 2+ cars; until then it is still learning. ${lib.shared ? '' : 'Admins can turn on shared learning under Settings to learn from other workshops too.'}</div>
      ${table(['Engine', 'Vehicles', 'Your vehicles', 'Live scans', 'Pulls', 'ECU versions seen', 'Status'], lib.engines.map((e) => `<tr><td>${esc(e.label)}</td><td>${e.vehicles}</td><td>${e.yourVehicles}</td><td>${e.scans}</td><td>${e.pulls}</td><td>${e.calibrations}</td><td>${e.learned ? '<span class="badge b-green">learned</span>' : '<span class="badge b-blue">learning</span>'}</td></tr>`), 'Nothing learned yet. Every live scan, pull and ECU read on a vehicle with make, model and engine filled in teaches the system.')}</div>`);
  $('#tune-vehicle').addEventListener('change', () => loadTune());
  if (pull.vid) { $('#tune-vehicle').value = pull.vid; }
  if ($('#tune-vehicle').value) loadTune();
  renderPull();
};

async function loadTune() {
  const vid = Number($('#tune-vehicle') && $('#tune-vehicle').value); const box = $('#tune-body'); if (!box) return;
  if (!vid) { box.innerHTML = '<div class="empty">Pick a vehicle to see its tuning picture.</div>'; return; }
  const r = await api('/tuning/vehicle/' + vid); loadTune.data = r;
  const verdict = { ready: ['b-green', 'Ready to tune'], not_ready: ['b-red', 'Not ready — fix these first'], incomplete: ['b-amber', 'Not enough data yet'] }[r.readiness.verdict];
  const eng = r.engine;
  const sw = r.software;
  box.innerHTML = `<div class="grid-2" style="margin-bottom:12px">
    <div class="card"><div class="card-title">Tune readiness <span class="badge ${verdict[0]}">${verdict[1]}</span></div>
      ${r.readiness.checks.map((c) => `<div class="mon"><span>${esc(c.text)}</span><span class="badge ${c.ok === true ? 'b-green' : c.ok === false ? 'b-red' : 'b-amber'}">${c.ok === true ? 'OK' : c.ok === false ? 'Fix' : 'To do'}</span></div>`).join('')}
      ${r.health && r.health.checks.length ? `<div style="margin-top:8px">${r.health.checks.map((c) => `<div class="annotation" style="margin-top:6px">${c.level === 'fail' ? '⛔' : '⚠'} ${esc(c.text)}</div>`).join('')}</div>` : ''}</div>
    <div class="card"><div class="card-title">ECU software</div>
      ${sw.lastRead ? `<div class="page-sub">Last read ${day(sw.lastRead.at)}${sw.lastRead.names && sw.lastRead.names.length ? ' · ' + esc(sw.lastRead.names.join(', ')) : ''}</div>
        ${table(['Calibration ID', 'Checksum (CVN)', 'Status', 'Seen on'], sw.current.map((c) => `<tr><td style="font-family:var(--fm)">${esc(c.calid)}</td><td style="font-family:var(--fm)">${esc(c.cvn || '—')}</td><td>${c.label === 'stock' ? '<span class="badge b-green">stock</span>' : c.label === 'tuned' ? '<span class="badge b-purple">tuned</span>' : '<span class="badge b-blue">not yet known</span>'}</td><td>${c.seenOn} car${c.seenOn === 1 ? '' : 's'}</td></tr>`), 'The ECU did not report a calibration ID.')}
        ${sw.changed ? `<div class="annotation" style="margin-top:8px">ECU software changed since ${day(sw.changed.since)}. ${sw.changed.remapLogged ? 'A remap was logged in between — expected.' : '<b>No remap was logged</b> — it may have been tuned elsewhere or updated by a dealer.'}</div>` : ''}`
      : '<div class="empty">Not read yet. Connect the adapter and press <b>Read ECU software</b>. It is read-only and changes nothing on the car.</div>'}
      ${sw.knownForEngine.length ? `<div class="page-sub" style="margin:10px 0 4px">Software versions seen on ${esc(eng.label)}</div>${table(['Calibration ID', 'CVN', 'Cars', 'Learned as'], sw.knownForEngine.slice(0, 12).map((c) => `<tr><td style="font-family:var(--fm)">${esc(c.calid)}</td><td style="font-family:var(--fm)">${esc(c.cvn || '—')}</td><td>${c.vehicles}</td><td>${esc(c.label)}</td></tr>`))}` : ''}</div></div>
  <div class="card" style="margin-bottom:12px"><div class="card-title">This car vs. its engine <span class="badge ${eng.learned ? 'b-green' : 'b-blue'}">${eng.learned ? `learned from ${eng.vehicles} cars · ${eng.scans} scans` : `learning — ${eng.scans}/${eng.needs.scans} scans from ${eng.vehicles}/${eng.needs.vehicles} other cars`}</span></div>
    ${r.health ? `<div class="page-sub" style="margin-bottom:6px">Last live scan ${day(r.health.at)} compared with other ${esc(eng.label)} engines${eng.shared ? ' (including shared data)' : ''}. "Typical" is the middle 80% of what has been seen.</div>
      ${table(['Parameter', 'This car (average)', 'Typical for this engine', 'Status'], r.health.vsEngine.map((c) => `<tr><td>${esc(c.name)}</td><td>${fmt(c.value)} ${esc(c.unit)}</td><td>${c.low == null ? '—' : `${fmt(c.low)} – ${fmt(c.high)} ${esc(c.unit)}`} <span style="color:var(--muted)">(${c.basedOn})</span></td><td>${statusBadge(c.status)}</td></tr>`), 'No comparable data yet.')}`
      : '<div class="empty">No live scan for this car yet. Run one from the Live scanner with the engine warm.</div>'}</div>
  <div class="card" style="margin-bottom:12px"><div class="card-title">ECU tuning notes ${r.ecu.shared ? '<span class="badge b-green">shared library on</span>' : '<span class="badge b-blue">your workshop</span>'} <button class="btn sm" data-act="ecu-note">${r.ecu.documented ? 'Edit note' : '+ Add note'}</button></div>
    <div class="page-sub" style="margin-bottom:8px">Reference only — records how an ECU type is read/written and whether a tune is road-legal. It does <b>not</b> unlock, flash or modify any ECU; flashing needs a licensed tool.</div>
    ${r.ecu.names.length ? `<div class="page-sub" style="margin-bottom:6px">ECU read on this car: ${r.ecu.names.map(esc).join(', ')}</div>` : '<div class="page-sub" style="margin-bottom:6px">Read the ECU software (button above) to match this car to your notes.</div>'}
    ${r.ecu.reference.length ? r.ecu.reference.map((g) => `<div style="margin-top:8px"><b>${esc(g.ecu_name)}</b>${g.make ? ' · ' + esc(g.make) : ''} <span class="badge b-blue">${g.shops} shop${g.shops === 1 ? '' : 's'}</span>
      ${table(['Access', 'Tool', 'Road-legal', 'Notes', ''], g.entries.map((e) => `<tr><td>${accessLabel(e.access_method)}</td><td>${esc(e.tool || '—')}</td><td>${legalBadge(e.road_legal)}</td><td>${esc(e.security_note || e.notes || '—')}</td><td>${e.mine ? '<span class="badge b-green">yours</span>' : ''}</td></tr>`))}</div>`).join('')
      : '<div class="empty">No notes for this ECU yet. Add one so your team — and, if you opt in to the shared library, other workshops — know how it is tuned.</div>'}</div>
  <div class="card"><div class="card-title">Pulls (full-throttle runs) <button class="btn sm" data-act="pull-compare">Compare ticked</button></div>
    ${r.pulls.length ? table(['', 'Date', 'Est. power*', 'Peak airflow', 'Peak boost', 'Peak timing', 'Peak IAT', 'Peak RPM', ''], r.pulls.map((p) => `<tr><td><input type="checkbox" data-pull="${p.id}"></td><td>${day(p.at)} ${esc(String(p.at).slice(11, 16))}</td><td><b>${fmt(p.peaks.estKw)}</b> kW</td><td>${fmt(p.peaks.mafGs)} g/s</td><td>${fmt(p.peaks.boostBar)} bar</td><td>${fmt(p.peaks.timingDeg)}°</td><td>${fmt(p.peaks.iatC)} °C</td><td>${fmt(p.peaks.rpm)}</td><td><button class="btn sm" data-act="pull-dyno" data-arg="${p.id}">Dyno &amp; checks</button></td></tr>`))
      + '<div class="page-sub" style="margin-top:6px">* Estimated from peak airflow (petrol engines, about ±15%). Best used to compare the same car before and after a change, not as a dyno figure.</div>'
      : '<div class="empty">No pulls recorded. Record one before and one after a tune to see what changed.</div>'}
    <div id="pull-dyno-out"></div><div id="pull-compare-out"></div></div>`;
}

const accessLabel = (a) => ({ obd: 'OBD port', bench: 'Bench', boot: 'Boot mode', unknown: 'Unknown' }[a] || esc(a));
const legalBadge = (l) => ({ road: '<span class="badge b-green">road-legal</span>', track: '<span class="badge b-amber">track only</span>', check: '<span class="badge b-blue">check legality</span>' }[l] || esc(l));
function ecuNoteForm(v = {}) {
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([val, lbl]) => `<option value="${val}"${val === cur ? ' selected' : ''}>${lbl}</option>`).join('')}</select>`;
  return `<div class="field"><label>ECU name</label><input name="ecu_name" value="${esc(v.ecu_name || '')}" placeholder="e.g. Bosch MED17.5.5" required></div>
    <div class="grid-2"><div class="field"><label>Make (optional)</label><input name="make" value="${esc(v.make || '')}"></div>
    <div class="field"><label>Access method</label>${sel('access_method', [['unknown', 'Unknown'], ['obd', 'OBD port'], ['bench', 'Bench'], ['boot', 'Boot mode']], v.access_method || 'unknown')}</div></div>
    <div class="grid-2"><div class="field"><label>Tool used (optional)</label><input name="tool" value="${esc(v.tool || '')}" placeholder="e.g. KESS3, Autotuner"></div>
    <div class="field"><label>Road-legal</label>${sel('road_legal', [['check', 'Check legality'], ['road', 'Road-legal'], ['track', 'Track only']], v.road_legal || 'check')}</div></div>
    <div class="field"><label>Security / access note (optional)</label><input name="security_note" value="${esc(v.security_note || '')}" placeholder="e.g. OBD locked from MY2018 — bench only"></div>
    <div class="field"><label>Notes (optional)</label><textarea name="notes" rows="3">${esc(v.notes || '')}</textarea></div>
    <div class="page-sub">Your reference only. Do not record anything that bypasses manufacturer security or defeats emissions equipment.</div>`;
}
function dynoChart(id, curves) {
  drawChart($(id), curves.map((c) => ({ label: c.label, points: c.curve.filter((x) => x.kw != null).map((x) => ({ t: x.rpm, v: x.kw })) })), 'kW', { xUnit: 'rpm' });
}

function renderPull() {
  const box = $('#pull-box'); if (!box) return;
  if (!pull.running) { box.innerHTML = ''; return; }
  const st = pull.stats; const show = (pid, label, unit) => (st[pid] ? `<div class="gauge active"><div class="g-label">${label} (peak)</div><div class="g-value">${fmt(st[pid].max)}</div><div class="g-unit">${unit}</div></div>` : '');
  box.innerHTML = `<div class="annotation" style="margin-top:10px">${pull.recording ? `● RECORDING — ${(((Date.now() - pull.started) / 1000)).toFixed(1)} s. Lift off to finish.` : pull.armed ? 'ARMED — on a dyno or closed road, go to full throttle (2nd–4th gear) from low RPM. Recording starts automatically at full throttle and stops when you lift off.' : ''}
      <button class="btn sm" data-act="pull-start">Start now</button> <button class="btn sm danger" data-act="pull-stop">${pull.recording ? 'Stop & save' : 'Cancel'}</button></div>
    <div class="gauge-grid" style="margin-top:8px">${show('010C', 'RPM', 'rpm')}${show('0110', 'Airflow', 'g/s')}${show('010B', 'Manifold pressure', 'kPa')}${show('010E', 'Timing', '°')}${show('010F', 'Intake air', '°C')}</div>`;
}

async function runPull() {
  const ref = new Map((await api('/reference/pids')).map((p) => [p.pid, p]));
  while (pull.running) {
    let v;
    try { v = await elm.readPids(pull.pids); } catch (e) {
      if (await elm.reconnect()) continue;
      pull.running = false; toast('Adapter disconnected: ' + e.message, 'error'); break;
    }
    const thr = v['11'] ?? v['49'];
    if (pull.armed && !pull.recording && thr != null && thr >= 85) { pull.recording = true; pull.started = Date.now(); }
    if (pull.recording) {
      const sample = { t: Date.now() - pull.started };
      for (const [pid, val] of Object.entries(v)) {
        if (val == null || Number.isNaN(val)) continue;
        const key = '01' + pid; const p = ref.get(key) || {};
        const st = pull.stats[key] || (pull.stats[key] = { name: p.name || key, unit: p.unit || '', min: val, max: val, sum: 0, n: 0 });
        st.min = Math.min(st.min, val); st.max = Math.max(st.max, val); st.sum += val; st.n++; sample[key] = +val.toFixed(2);
      }
      pull.samples.push(sample);
      pull.low = thr != null && thr < 40 ? pull.low + 1 : 0;
      if (pull.low >= 2 || Date.now() - pull.started > 30000) { await finishPull(); break; }
    }
    renderPull();
  }
  renderPull();
}

async function finishPull() {
  pull.running = false; pull.armed = false; pull.recording = false;
  if (pull.samples.length < 3) { toast('Pull too short to save.', 'error'); return; }
  const summary = {};
  for (const [k, st] of Object.entries(pull.stats)) summary[k] = { name: st.name, unit: st.unit, min: st.min, max: st.max, avg: +(st.sum / st.n).toFixed(2), n: st.n };
  const saved = await api('/scans', { method: 'POST', body: { vehicle_id: pull.vid, protocol: elm.protocol, source: 'adapter', kind: 'pull', summary, samples: pull.samples.slice(-600) } });
  toast(`Pull saved (#${saved.id}).`, 'success');
  if (state.page === 'tune') loadTune();
}

// ----- scan history -----
views.history = async (el) => {
  const [scans, vehicles] = await Promise.all([api('/scans'), api('/vehicles')]);
  const vm = new Map(vehicles.map((v) => [v.id, v]));
  el.innerHTML = page('Scan history', 'Graph a saved scan, or tick two to overlay them (before/after a repair or remap)', '<button class="btn primary" data-act="hist-chart">Graph selected</button>',
    `<div class="card" style="margin-bottom:12px"><div class="card-title">Graph <select id="hist-pid" style="font-size:12px"></select></div><canvas class="chart" id="hist-chart"></canvas></div>
     <div class="card">${table(['', 'Date', 'Vehicle', 'Protocol', 'Source', 'MIL', 'Parameters'], scans.map((s) => `<tr><td><input type="checkbox" data-scan="${s.id}"></td><td>${day(s.started_at)} ${esc(String(s.started_at).slice(11, 16))}</td><td>${esc(vm.get(s.vehicle_id) ? vehLabel(vm.get(s.vehicle_id)) : '—')}</td><td>${esc(s.protocol || '—')}</td><td>${s.source === 'demo' ? '<span class="demo-tag">DEMO</span>' : 'adapter'}</td><td>${s.readiness ? (s.readiness.mil ? '<span class="badge b-red">ON</span>' : 'off') : '—'}</td><td>${Object.keys(s.summary || {}).length}</td></tr>`), 'No scans saved yet.')}</div>`);
  views.history.loaded = [];
  $('#hist-pid').addEventListener('change', renderHist);
};
function renderHist() {
  const sel = $('#hist-pid').value; const loaded = views.history.loaded;
  drawChart($('#hist-chart'), loaded.map((s) => ({ label: `#${s.id} ${day(s.started_at)}`, points: (s.samples || []).filter((x) => x[sel] !== undefined).map((x) => ({ t: x.t, v: x[sel] })) })), (loaded[0] && loaded[0].summary && loaded[0].summary[sel] || {}).unit);
}

// ----- jobs board -----
const JOB_COLS = [['booked', 'Booked'], ['in_progress', 'In progress'], ['ready', 'Ready for collection'], ['done', 'Done']];
views.jobs = async (el) => {
  const jobs = await api('/jobs'); views.jobs.rows = jobs;
  const card = (j, i) => `<div class="kcard"><b>${esc(j.title)}</b><div class="kmeta">${esc(j.vehicle ? vehLabel(j.vehicle) : 'No vehicle')}${j.customer ? ' · ' + esc(fullName(j.customer)) : ''}</div>
    <div class="kmeta">${j.scheduled_for ? new Date(j.scheduled_for).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not scheduled'}${j.assignee ? ' · 🔧 ' + esc(j.assignee) : ''}</div>
    <div class="row-actions">${i > 0 ? `<button class="btn sm" data-act="job-move" data-arg="${j.id}:${JOB_COLS[i - 1][0]}">←</button>` : ''}${i < 3 ? `<button class="btn sm success" data-act="job-move" data-arg="${j.id}:${JOB_COLS[i + 1][0]}">→</button>` : ''}<button class="btn sm" data-act="job-edit" data-arg="${j.id}">Edit</button><button class="btn sm danger" data-act="job-del" data-arg="${j.id}">×</button></div></div>`;
  el.innerHTML = page('Jobs board', 'Bookings and work in progress', '<button class="btn primary" data-act="job-new">+ New job</button>',
    `<div class="kanban">${JOB_COLS.map(([k, label], i) => { const list = jobs.filter((j) => j.status === k); return `<div class="kcol"><h4>${label} · ${list.length}</h4>${list.map((j) => card(j, i)).join('') || '<div class="kmeta" style="padding:6px">Empty</div>'}</div>`; }).join('')}</div>`);
};
async function jobForm(j = {}) {
  const [vs, cs] = await Promise.all([api('/vehicles'), api('/customers')]);
  let users = []; if (state.user.role === 'admin') users = await api('/users');
  const local = j.scheduled_for ? new Date(new Date(j.scheduled_for).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  return `<div class="form-grid"><div class="field form-full"><label>What needs doing</label><input name="title" value="${esc(j.title)}" placeholder="e.g. 60,000 km service" required></div>
    <div class="field"><label>Vehicle</label><select name="vehicle_id">${vehOptions(vs, j.vehicle_id)}</select></div><div class="field"><label>Customer</label><select name="customer_id">${custOptions(cs, j.customer_id)}</select></div>
    <div class="field"><label>Date &amp; time</label><input type="datetime-local" name="scheduled_for" value="${local}"></div>
    <div class="field"><label>Technician</label><select name="assigned_to"><option value="">— unassigned —</option>${users.map((u) => `<option value="${u.id}"${j.assigned_to === u.id ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
    <div class="field form-full"><label>Notes</label><textarea name="notes" rows="2">${esc(j.notes)}</textarea></div></div>`;
}
const jobBody = (f) => { const b = clean(f); if (b.scheduled_for) b.scheduled_for = new Date(b.scheduled_for).toISOString(); return b; };

// ----- parts & stock -----
views.parts = async (el) => {
  const rows = await api('/parts'); views.parts.rows = rows;
  const low = rows.filter((p) => p.low_stock).length;
  el.innerHTML = page('Parts & stock', `${rows.length} parts${low ? ` · <span style="color:var(--amber)">${low} low on stock</span>` : ''} · your own inventory; invoices deduct stock automatically`, '<button class="btn" data-act="part-import">Import CSV</button><button class="btn primary" data-act="part-new">+ Add part</button>',
    `<div class="card">${table(['SKU', 'Part', 'Supplier', 'Cost', 'Price', 'In stock', ''], rows.map((p) => `<tr><td style="font-family:var(--fm)">${esc(p.sku || '—')}</td><td>${esc(p.name)}</td><td>${esc(p.supplier || '—')}</td><td>${money(p.cost_cents)}</td><td>${money(p.price_cents)}</td><td><span class="badge ${p.low_stock ? 'b-red' : 'b-green'}">${p.qty}</span></td>
      <td class="row-actions"><button class="btn sm" data-act="part-adj" data-arg="${p.id}">± Stock</button><button class="btn sm" data-act="part-edit" data-arg="${p.id}">Edit</button><button class="btn sm danger" data-act="part-del" data-arg="${p.id}">Delete</button></td></tr>`), 'No parts yet. Add them one by one or import a CSV.')}</div>`);
};
const partForm = (p = {}) => `<div class="form-grid"><div class="field"><label>Part name</label><input name="name" value="${esc(p.name)}" required></div><div class="field"><label>SKU / part no.</label><input name="sku" value="${esc(p.sku)}"></div>
  <div class="field"><label>Supplier</label><input name="supplier" value="${esc(p.supplier)}"></div><div class="field"><label>In stock</label><input name="qty" type="number" min="0" value="${p.qty ?? 0}"></div>
  <div class="field"><label>Cost price (R)</label><input name="cost" type="number" step="0.01" min="0" value="${((p.cost_cents || 0) / 100).toFixed(2)}"></div><div class="field"><label>Selling price (R)</label><input name="price" type="number" step="0.01" min="0" value="${((p.price_cents || 0) / 100).toFixed(2)}"></div>
  <div class="field"><label>Warn me at or below</label><input name="min_qty" type="number" min="0" value="${p.min_qty ?? 0}"></div></div>`;
const partBody = (f) => ({ name: f.name, sku: f.sku || null, supplier: f.supplier || null, qty: Number(f.qty || 0), min_qty: Number(f.min_qty || 0), cost_cents: Math.round(Number(f.cost || 0) * 100), price_cents: Math.round(Number(f.price || 0) * 100) });

// ----- inspection photos -----
async function renderPhotos(id) {
  const list = await api(`/inspections/${id}/photos`);
  const box = $('#photo-grid'); if (!box) return;
  box.innerHTML = list.length ? '' : '<div class="empty">No photos yet.</div>';
  for (const p of list) {
    const fig = document.createElement('figure'); fig.innerHTML = `<img alt=""><figcaption>${esc(p.item || 'Photo')}</figcaption><button class="btn sm danger" type="button" data-act="photo-del" data-arg="${id}:${p.id}">×</button>`;
    box.appendChild(fig);
    apiBlob(`/inspections/${id}/photos/${p.id}/image`).then((b) => { fig.querySelector('img').src = URL.createObjectURL(b); }).catch(() => {});
  }
}

// ----- settings -----
views.settings = async (el) => {
  const s = await api('/shop'); const admin = state.user.role === 'admin'; state.pendingLogo = undefined;
  const pwCard = `<div class="card" style="margin-top:12px;max-width:520px"><div class="card-title">Your password</div>
      <div class="field"><label>Current password</label><input id="pw-cur" type="password" autocomplete="current-password"></div>
      <div class="field"><label>New password (8–72 characters)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
      <div class="page-sub" style="margin-bottom:10px">Changing it signs you out everywhere else.</div>
      <button class="btn" data-act="pw-change">Change password</button></div>`;
  if (!admin) { el.innerHTML = page('Settings', '', '', '<div class="empty">Only admins can change workshop settings.</div>' + pwCard); return; }
  el.innerHTML = page('Settings', 'Your details appear on invoices, quotes and reports', '<button class="btn primary" data-act="settings-save">Save settings</button>',
    `<div class="grid-2"><div class="card"><div class="card-title">Workshop profile</div>
      <div class="field"><label>Workshop name</label><input id="s-name" value="${esc(s.name)}"></div><div class="field"><label>Email</label><input id="s-email" type="email" value="${esc(s.email)}"></div>
      <div class="field"><label>Phone</label><input id="s-phone" value="${esc(s.phone)}"></div><div class="field"><label>Address</label><input id="s-address" value="${esc(s.address)}"></div>
      <div class="field"><label>VAT number (prices are treated as VAT-inclusive when set)</label><input id="s-vat" value="${esc(s.vat_number)}"></div>
      <div class="field"><label>Banking details (printed on unpaid invoices)</label><textarea id="s-bank" rows="3">${esc(s.bank_details)}</textarea></div>
      <div class="field"><label>Logo (PNG or JPEG)</label><input id="s-logo" type="file" accept="image/png,image/jpeg"> ${s.logo ? `<div style="margin-top:6px"><img src="${s.logo}" alt="logo" style="max-height:50px;background:#fff;border-radius:4px;padding:3px"> <button class="btn sm danger" type="button" data-act="logo-clear">Remove</button></div>` : ''}</div></div>
    <div><div class="card" style="margin-bottom:12px"><div class="card-title">Service reminders</div>
      <label class="chk" style="border:0"><input type="checkbox" id="s-rem" ${s.reminders_enabled ? 'checked' : ''}> Email / SMS customers a week before their vehicle's next service date</label>
      <div class="page-sub" style="margin-top:6px">Only enable this if your customers have agreed to receive service messages. Set each vehicle's next service date under Vehicles.</div></div>
    <div class="card" style="margin-bottom:12px"><div class="card-title">Engine learning</div>
      <label class="chk" style="border:0"><input type="checkbox" id="s-share" ${s.share_engine_data ? 'checked' : ''}> Share anonymous engine data with other workshops (and learn from theirs)</label>
      <div class="page-sub" style="margin-top:6px">Shares scan readings and ECU software IDs per engine type only — never customers, plates, VINs or vehicle records. Engines are learned much faster when many workshops pool their data. You only see pooled data while you share too.</div></div>
    <div class="card"><div class="card-title">Customer card payments (your PayFast account)</div>
      <div class="page-sub" style="margin-bottom:10px">Payment links on invoices pay <b>into your own PayFast account</b>. Enter your merchant details; the key and passphrase are stored encrypted and are never shown again.</div>
      <div class="field"><label>Merchant ID</label><input id="s-pfid" value="${esc(s.pf_merchant_id)}"></div>
      <div class="field"><label>Merchant key ${s.pf_key_set ? '(saved — leave blank to keep)' : ''}</label><input id="s-pfkey" type="password" autocomplete="off"></div>
      <div class="field"><label>Passphrase ${s.pf_passphrase_set ? '(saved — leave blank to keep)' : ''}</label><input id="s-pfpass" type="password" autocomplete="off"></div></div></div></div>
    ${pwCard}
    <div class="danger-zone"><div class="card-title" style="margin-bottom:6px">Your data</div><div class="page-sub" style="margin-bottom:10px">Download everything stored for your workshop, or permanently delete the account and all its data.</div>
      <button class="btn" data-act="export-data">⬇ Download all my data</button> <button class="btn danger" data-act="delete-account">Delete account…</button></div>`);
  $('#s-logo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const url = await resizeToDataUrl(f, 300, 'image/png'); if (url.length > 380000) throw new Error('Logo is too detailed — use a simpler image'); state.pendingLogo = url; toast('Logo ready — press Save settings.', 'info'); } catch (ex) { toast(ex.message, 'error'); }
  });
};

views.audit = async (el) => {
  if (state.user.role !== 'admin') { el.innerHTML = page('Audit log', '', '', '<div class="empty">Only admins can view the audit log.</div>'); return; }
  const rows = await api('/shop/audit');
  el.innerHTML = page('Audit log', 'Who changed what, most recent first (request contents are not stored)', '',
    `<div class="card">${table(['When', 'Who', 'Action', 'Record'], rows.map((r) => `<tr><td>${esc(String(r.created_at).replace('T', ' ').slice(0, 16))}</td><td>${esc(r.user_name || '—')}</td><td style="font-family:var(--fm);font-size:11px">${esc(r.action)}</td><td>${r.entity_id ? esc(r.entity + ' #' + r.entity_id) : '—'}</td></tr>`), 'Nothing recorded yet.')}</div>`);
};

// ----- extra actions -----
Object.assign(actions, {
  'resend-verify': guard(async () => { await api('/auth/resend-verification', { method: 'POST' }); toast('Verification email sent.', 'success'); }),
  'hist-chart': guard(async () => {
    const ids = [...document.querySelectorAll('[data-scan]:checked')].map((c) => c.dataset.scan).slice(0, 2);
    if (!ids.length) return toast('Tick one or two scans first.', 'error');
    views.history.loaded = await Promise.all(ids.map((i) => api('/scans/' + i)));
    const pids = new Set(); views.history.loaded.forEach((s) => Object.keys(s.summary || {}).forEach((k) => pids.add(k)));
    const names = {}; views.history.loaded.forEach((s) => Object.entries(s.summary || {}).forEach(([k, v]) => { names[k] = v.name; }));
    $('#hist-pid').innerHTML = [...pids].map((k) => `<option value="${k}">${esc(names[k] || k)}</option>`).join('');
    renderHist();
  }),
  readiness: guard(async () => {
    if (!elm.connected) return toast('Connect the adapter first.', 'error');
    const r = await elm.readReadiness(); if (!r) return toast('The car did not answer the readiness request.', 'error');
    state.lastReadiness = r;
    $('#dtc-extra').innerHTML = `<div style="margin-top:12px"><span class="badge ${r.mil ? 'b-red' : 'b-green'}">Warning light ${r.mil ? 'ON' : 'off'}</span> <span class="badge b-blue">${r.dtcCount} stored code${r.dtcCount === 1 ? '' : 's'}</span> <span class="badge b-purple">${r.type === 'compression' ? 'Diesel' : 'Petrol'} monitors</span>
      <div style="margin-top:8px">${r.monitors.map((m) => `<div class="mon"><span>${esc(m.name)}</span><span class="badge ${m.ready ? 'b-green' : 'b-amber'}">${m.ready ? 'Ready' : 'Not ready'}</span></div>`).join('')}</div>
      <div class="page-sub" style="margin-top:6px">“Not ready” monitors can fail an emissions or roadworthy check; they complete after a drive cycle (they reset when codes are cleared).</div></div>`;
  }),
  freeze: guard(async () => {
    if (!elm.connected) return toast('Connect the adapter first.', 'error');
    const [ff, pids] = await Promise.all([elm.readFreezeFrame(), api('/reference/pids')]);
    if (!ff) return toast('No freeze-frame data stored in the car.', 'info');
    state.lastFreeze = ff; const nm = new Map(pids.map((p) => [p.pid.slice(2), p]));
    $('#dtc-extra').innerHTML = `<div style="margin-top:12px"><b>Freeze frame</b>${ff.dtc ? ` — triggered by <span class="badge b-amber">${esc(ff.dtc)}</span>` : ''}${table(['Parameter', 'Value'], Object.entries(ff.values).map(([k, v]) => `<tr><td>${esc((nm.get(k) || {}).name || k)}</td><td>${Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(2)} ${esc((nm.get(k) || {}).unit || '')}</td></tr>`))}</div>`;
  }),
  mode06: guard(async () => {
    if (!elm.connected) return toast('Connect the adapter first.', 'error');
    toast('Reading on-board monitor tests…', 'info');
    const r = await elm.readMonitorTests();
    if (!r) return toast(elm.isCan ? 'The car did not report any monitor test results.' : 'Monitor tests (Mode 06) are only read on CAN cars (most 2008+) in this version.', 'info');
    const failed = r.filter((t) => !t.pass).length;
    $('#dtc-extra').innerHTML = `<div style="margin-top:12px"><b>On-board monitor tests</b> <span class="badge ${failed ? 'b-red' : 'b-green'}">${r.length - failed} of ${r.length} passed</span>
      ${table(['Monitor', 'Test', 'Result', 'Allowed range', ''], r.map((t) => `<tr><td>${esc(t.monitor)}</td><td>${t.tid.toString(16).toUpperCase().padStart(2, '0')}</td><td>${t.value} ${esc(t.unit)}</td><td>${t.min} – ${t.max}</td><td><span class="badge ${t.pass ? 'b-green' : 'b-red'}">${t.pass ? 'Pass' : 'FAIL'}</span></td></tr>`))}
      <div class="page-sub" style="margin-top:6px">These are the car's own self-test results. A value close to its limit points at a part that is wearing out before it sets a fault code. Test IDs are manufacturer-defined — check service data for what each one measures.</div></div>`;
    const vid = Number($('#dtc-vehicle').value) || null;
    if (vid) { await api('/scans', { method: 'POST', body: { vehicle_id: vid, protocol: elm.protocol, source: 'adapter', monitor_tests: r } }); toast('Monitor tests saved to the vehicle history.', 'success'); }
  }),
  'pid-sel': async (which) => {
    const std = renderPidPicker.std || []; const sup = elm.connected && elm.supported.size ? elm.supported : null;
    const avail = std.filter((p) => !sup || sup.has(p.pid.slice(2)));
    savePidSel(new Set(which === 'all' ? avail.map((p) => p.pid) : which === 'none' ? [] : std.filter((p) => p.gM).map((p) => p.pid)));
    renderPidPicker();
  },
  'tune-ecu': guard(async () => {
    const vid = Number($('#tune-vehicle').value); if (!vid) return toast('Pick the vehicle first.', 'error');
    if (!elm.connected) return toast('Connect the adapter first (Live scanner → Connect adapter).', 'error');
    toast('Reading ECU software identification…', 'info');
    const info = await elm.readEcuInfo();
    if (!info) return toast('The ECU did not report its software identification.', 'error');
    await api('/scans', { method: 'POST', body: { vehicle_id: vid, protocol: elm.protocol, source: 'adapter', ecu_info: info } });
    const v = (await api('/vehicles')).find((x) => x.id === vid);
    if (info.vin && v && !v.vin) await api('/vehicles/' + vid, { method: 'PATCH', body: { vin: info.vin } });
    toast(`ECU software read: ${info.calids.length} calibration ID${info.calids.length === 1 ? '' : 's'}.`, 'success');
    loadTune();
  }),
  'pull-arm': guard(async () => {
    const vid = Number($('#tune-vehicle').value); if (!vid) return toast('Pick the vehicle first.', 'error');
    if (!elm.connected) return toast('Connect the adapter first (Live scanner → Connect adapter).', 'error');
    if (pull.running) return;
    const sup = elm.supported;
    const pids = PULL_PIDS.filter((p) => ELM327.DECODE[p] && (!sup.size || sup.has(p)));
    if (!pids.includes('0C')) return toast('This car does not report engine RPM.', 'error');
    Object.assign(pull, { armed: true, recording: false, running: true, samples: [], stats: {}, started: 0, low: 0, vid, pids });
    if (!pids.includes('11') && !pids.includes('49')) toast('No throttle sensor reported — press Start now at full throttle and Stop when done.', 'info');
    renderPull(); runPull();
  }),
  'pull-start': () => { if (pull.running && !pull.recording) { pull.recording = true; pull.started = Date.now(); } },
  'pull-stop': guard(async () => { if (!pull.running) return; if (pull.recording) await finishPull(); else { pull.running = false; pull.armed = false; } renderPull(); }),
  'ecu-note': guard(async () => {
    const r = loadTune.data || {}; const ecu = r.ecu || { names: [], reference: [] };
    const name = ecu.names[0] || '';
    const grp = ecu.reference.find((g) => g.ecu_name === name) || ecu.reference.find((g) => g.entries.some((e) => e.mine));
    const own = grp && grp.entries.find((e) => e.mine);
    const prefill = own ? { ecu_name: grp.ecu_name, make: grp.make, access_method: own.access_method, tool: own.tool, road_legal: own.road_legal, security_note: own.security_note, notes: own.notes } : { ecu_name: name };
    openModal('ECU tuning note', ecuNoteForm(prefill), guard(async (f) => {
      await api('/tuning/ecu', { method: 'POST', body: f }); closeModal(); loadTune();
    }));
  }),
  'pull-dyno': guard(async (id) => {
    const d = await api('/tuning/pull/' + id);
    $('#pull-compare-out').innerHTML = '';
    $('#pull-dyno-out').innerHTML = `<div style="margin-top:12px"><b>Pull #${d.id} — virtual dyno</b> ${d.peak ? `<span class="badge b-green">${d.peak.kw} kW @ ${d.peak.kwRpm} rpm</span> <span class="badge b-blue">${d.peak.nm} Nm @ ${d.peak.nmRpm} rpm</span>` : ''} <span class="page-sub">${d.rpmFrom ?? '—'}–${d.rpmTo ?? '—'} rpm · estimated from airflow</span>
      <canvas class="chart" id="dyno-chart" style="margin-top:8px"></canvas>
      ${d.warnings.length ? d.warnings.map((w) => `<div class="annotation" style="margin-top:6px">${w.level === 'fail' ? '⛔' : w.level === 'warn' ? '⚠' : 'ℹ'} ${esc(w.text)}</div>`).join('') : '<div class="page-sub" style="margin-top:6px">✓ No knock, lean-mixture or heat-soak signs in this pull.</div>'}
      ${table(['RPM', 'Est. power', 'Est. torque', 'Boost', 'Timing', 'λ cmd'], d.curve.filter((_, i) => i % 2 === 0).map((c) => `<tr><td>${c.rpm}</td><td>${fmt(c.kw)} kW</td><td>${fmt(c.nm)} Nm</td><td>${fmt(c.boostBar)} bar</td><td>${fmt(c.timing)}°</td><td>${fmt(c.lambda)}</td></tr>`))}</div>`;
    dynoChart('#dyno-chart', [{ label: `#${d.id}`, curve: d.curve }]);
  }),
  'pull-compare': guard(async () => {
    const ids = [...document.querySelectorAll('[data-pull]:checked')].map((c) => Number(c.dataset.pull)).sort((a, b) => a - b);
    if (ids.length !== 2) return toast('Tick exactly two pulls (before and after).', 'error');
    const c = await api(`/tuning/compare?before=${ids[0]}&after=${ids[1]}`);
    $('#pull-dyno-out').innerHTML = '';
    $('#pull-compare-out').innerHTML = `<div style="margin-top:12px"><b>Before #${c.before.id} (${day(c.before.at)}) → after #${c.after.id} (${day(c.after.at)})</b>
      <canvas class="chart" id="dyno-compare" style="margin-top:8px"></canvas>
      ${table(['', 'Before', 'After', 'Change'], c.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${fmt(r.before)} ${esc(r.unit)}</td><td>${fmt(r.after)} ${esc(r.unit)}</td><td>${r.change == null ? '—' : `<span class="badge ${r.change >= 0 ? 'b-green' : 'b-red'}">${r.change >= 0 ? '+' : ''}${fmt(r.change)} ${esc(r.unit)}${r.pct != null ? ` (${r.pct >= 0 ? '+' : ''}${r.pct}%)` : ''}</span>`}</td></tr>`))}</div>`;
    dynoChart('#dyno-compare', [{ label: `Before #${c.before.id}`, curve: c.before.curve || [] }, { label: `After #${c.after.id}`, curve: c.after.curve || [] }]);
  }),
  'term-save': () => saveBlob(new Blob([termLog.map(([d, t]) => `${d} ${t}`).join('\n')], { type: 'text/plain' }), 'obd-terminal-log.txt'),
  'job-new': guard(async () => openModal('New job', await jobForm(), guard(async (f) => { await api('/jobs', { method: 'POST', body: jobBody(f) }); closeModal(); go('jobs'); }))),
  'job-edit': guard(async (id) => { const j = views.jobs.rows.find((x) => x.id === Number(id)); openModal('Edit job', await jobForm(j), guard(async (f) => { await api('/jobs/' + id, { method: 'PATCH', body: jobBody(f) }); closeModal(); go('jobs'); })); }),
  'job-move': guard(async (a) => { const [id, status] = a.split(':'); await api('/jobs/' + id, { method: 'PATCH', body: { status } }); go('jobs'); }),
  'job-del': guard(async (id) => { if (confirm('Delete this job?')) { await api('/jobs/' + id, { method: 'DELETE' }); go('jobs'); } }),
  'part-new': () => openModal('Add part', partForm(), guard(async (f) => { await api('/parts', { method: 'POST', body: partBody(f) }); closeModal(); go('parts'); })),
  'part-edit': (id) => { const p = views.parts.rows.find((x) => x.id === Number(id)); openModal('Edit part', partForm(p), guard(async (f) => { await api('/parts/' + id, { method: 'PATCH', body: partBody(f) }); closeModal(); go('parts'); })); },
  'part-del': guard(async (id) => { if (confirm('Delete this part?')) { await api('/parts/' + id, { method: 'DELETE' }); go('parts'); } }),
  'part-adj': guard(async (id) => { const v = prompt('Add (+) or remove (−) stock, e.g. 10 or -2'); if (v === null) return; await api(`/parts/${id}/adjust`, { method: 'POST', body: { delta: Number(v) } }); go('parts'); }),
  'part-import': () => openModal('Import parts from CSV', '<div class="page-sub" style="margin-bottom:8px">Paste rows with a header line: <code>name,sku,supplier,cost,price,qty,min_qty</code> (cost and price in rands).</div><textarea name="csv" rows="9" placeholder="name,sku,supplier,cost,price,qty,min_qty\nOil filter,OF-1,Acme,50,90,12,3"></textarea>',
    guard(async (f) => {
      const lines = f.csv.trim().split(/\r?\n/); const head = lines.shift().split(',').map((h) => h.trim().toLowerCase());
      const rows = lines.filter((l) => l.trim()).map((l) => { const c = l.split(','); const o = Object.fromEntries(head.map((h, i) => [h, (c[i] || '').trim()]));
        return { name: o.name, sku: o.sku || null, supplier: o.supplier || null, cost_cents: Math.round(Number(o.cost || 0) * 100), price_cents: Math.round(Number(o.price || 0) * 100), qty: Number(o.qty || 0), min_qty: Number(o.min_qty || 0) }; });
      const r = await api('/parts/import', { method: 'POST', body: { rows } }); closeModal(); toast(`Imported ${r.imported} parts.`, 'success'); go('parts');
    }), 'Import'),
  'inv-pdf': guard(async (id) => { const r = views.invoices.rows.find((x) => x.id === Number(id)); saveBlob(await apiBlob(`/invoices/${id}/pdf`), `${r.kind === 'quote' ? 'Quote' : 'Invoice'}-${String(r.number).padStart(4, '0')}.pdf`); }),
  'inv-email': guard(async (id) => { if (!confirm('Email this document (as a PDF) to the customer on file?')) return; const r = await api(`/invoices/${id}/email`, { method: 'POST' }); toast('Sent to ' + r.to, 'success'); }),
  'inv-link': guard(async (id) => {
    const r = await api(`/invoices/${id}/pay-link`, { method: 'POST' });
    openModal('Customer payment link', `<div class="page-sub" style="margin-bottom:8px">Send this link to your customer. Payment goes to your PayFast account and the invoice is marked paid automatically.</div><input id="paylink" readonly value="${esc(r.url)}" style="width:100%">`, async () => { try { await navigator.clipboard.writeText(r.url); toast('Link copied', 'success'); } catch (_) { $('#paylink').select(); } closeModal(); }, 'Copy link');
  }),
  'report-pdf': guard(async () => { const id = $('#rep-vehicle').value; if (!id) return toast('Select a vehicle.', 'error'); saveBlob(await apiBlob(`/reports/vehicle/${id}/pdf`), 'vehicle-report.pdf'); }),
  'insp-view': guard(async (id) => {
    openModal('Inspection photos', `<div class="field"><label>Item (optional)</label><input id="photo-item" placeholder="e.g. Front left tyre"></div><input id="photo-input" type="file" accept="image/*" multiple data-insp="${id}"><div class="thumbs" id="photo-grid"></div>`, async () => closeModal(), 'Done');
    await renderPhotos(id);
  }),
  'photo-del': guard(async (a) => { const [i, p] = a.split(':'); await api(`/inspections/${i}/photos/${p}`, { method: 'DELETE' }); renderPhotos(i); }),
  'logo-clear': guard(async () => { await api('/shop', { method: 'PUT', body: { logo: null } }); go('settings'); }),
  'settings-save': guard(async () => {
    const body = { name: $('#s-name').value, email: $('#s-email').value || null, phone: $('#s-phone').value || null, address: $('#s-address').value || null, vat_number: $('#s-vat').value || null, bank_details: $('#s-bank').value || null, reminders_enabled: $('#s-rem').checked, share_engine_data: $('#s-share').checked, pf_merchant_id: $('#s-pfid').value };
    if (state.pendingLogo) body.logo = state.pendingLogo;
    if ($('#s-pfkey').value) body.pf_merchant_key = $('#s-pfkey').value;
    if ($('#s-pfpass').value) body.pf_passphrase = $('#s-pfpass').value;
    const r = await api('/shop', { method: 'PUT', body }); state.user.tenant.name = r.name; $('#nav-shop').textContent = r.name; toast('Settings saved.', 'success'); go('settings');
  }),
  'pw-change': guard(async () => {
    const r = await api('/auth/change-password', { method: 'POST', body: { currentPassword: $('#pw-cur').value, newPassword: $('#pw-new').value } });
    setToken(r.token); $('#pw-cur').value = ''; $('#pw-new').value = ''; toast('Password changed. Other sessions were signed out.', 'success');
  }),
  'export-data': guard(async () => saveBlob(await apiBlob('/shop/export'), 'diagnosticos-export.json')),
  'delete-account': () => openModal('Delete account permanently', `<div class="annotation">This deletes your workshop and ALL its customers, vehicles, invoices, scans and team accounts. It cannot be undone. Download your data first.</div>
    <div class="field"><label>Type your workshop name (${esc(state.user.tenant.name)}) to confirm</label><input name="confirm"></div><div class="field"><label>Your password</label><input name="password" type="password" autocomplete="current-password"></div>`,
    guard(async (f) => { await api('/shop', { method: 'DELETE', body: f }); closeModal(); logout(); toast('Your account and data have been deleted.', 'info'); }), 'Delete everything'),
});

// photo uploads and part picking on invoices use change events
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'photo-input') {
    const id = t.dataset.insp; const item = $('#photo-item').value || null;
    for (const f of t.files) {
      try { const url = await resizeToDataUrl(f, 1280, 'image/jpeg', 0.72); await api(`/inspections/${id}/photos`, { method: 'POST', body: { mime: 'image/jpeg', data: url.split(',')[1], item } }); } catch (ex) { toast(ex.message, 'error'); }
    }
    t.value = ''; renderPhotos(id);
  } else if (t.id === 'part-pick' && t.value) {
    const p = (views.invoices.parts || []).find((x) => x.id === Number(t.value));
    if (p) { const rows = document.querySelectorAll('#lines .line-row'); const last = rows[rows.length - 1]; const empty = last && !last.querySelector('[name=desc]').value; const html = lineRow({ description: p.name, qty: 1, unit_cents: p.price_cents, part_id: p.id }); if (empty) last.outerHTML = html; else $('#lines').insertAdjacentHTML('beforeend', html); }
    t.value = '';
  } else if (t.id === 'chart-pid') drawLive();
});

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const fn = actions[t.dataset.act]; if (fn) { e.preventDefault(); fn(t.dataset.arg, t); }
});
document.addEventListener('submit', async (e) => {
  const form = e.target; e.preventDefault();
  if (form.id === 'modal-form') { if (modalSubmit) await modalSubmit(fd(form)); return; }
  const kind = form.dataset.form;
  if (kind === 'login' || kind === 'register') {
    const err = $(kind === 'login' ? '#login-err' : '#register-err'); err.textContent = '';
    try {
      const body = fd(form); if (kind === 'register') body.acceptTerms = form.acceptTerms.checked;
      const r = await api(kind === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body });
      setToken(r.token); form.reset(); await enterApp(r.user);
    } catch (ex) { err.textContent = ex.message; }
  } else if (kind === 'forgot') {
    try { await api('/auth/forgot', { method: 'POST', body: fd(form) }); $('#forgot-err').style.color = 'var(--green)'; $('#forgot-err').textContent = 'If that address has an account, a reset link is on its way.'; }
    catch (ex) { $('#forgot-err').textContent = ex.message; }
  } else if (kind === 'reset') {
    try { await api('/auth/reset', { method: 'POST', body: { token: resetToken, password: form.password.value } }); toast('Password changed. Please sign in.', 'success'); resetToken = null; history.replaceState(null, '', location.pathname); actions['auth-tab']('login'); }
    catch (ex) { $('#reset-err').textContent = ex.message; }
  } else if (kind === 'term') {
    const cmd = form.cmd.value.trim(); form.cmd.value = '';
    if (!cmd) return; if (!elm.connected) return toast('Connect the adapter first.', 'error');
    if (/^04$/.test(cmd) && !confirm('Mode 04 clears trouble codes and readiness monitors. Continue?')) return;
    try { await elm.send(cmd, 8000); } catch (ex) { toast(ex.message, 'error'); }
  }
});
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
window.addEventListener('hashchange', () => { if (state.user && location.hash.slice(1) !== state.page) go(location.hash.slice(1)); });

// ---------- boot ----------
let resetToken = null;
(async () => {
  const m = /^#(reset|verify)=([0-9a-f]{64})$/.exec(location.hash);
  if (m && m[1] === 'reset') { resetToken = m[2]; actions['auth-tab']('reset'); return; }
  if (m && m[1] === 'verify') {
    try { await api('/auth/verify', { method: 'POST', body: { token: m[2] } }); toast('Email verified. Thank you!', 'success'); } catch (e) { toast(e.message, 'error'); }
    history.replaceState(null, '', location.pathname);
  }
  if (!token) return;
  try { const me = await api('/auth/me'); await enterApp(me); } catch (_) { setToken(null); }
})();
})();
