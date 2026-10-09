// Self-learning engine knowledge. Every real scan teaches the system what "normal" looks like for that engine
// (make + model + engine), and every ECU identification read teaches it which software calibrations exist for that
// engine and which of them are stock or tuned. Nothing here is hard-coded per model, so it works for every model a
// workshop sees, and gets better with every car. Pure functions: the routes feed them rows from the database.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
function engineKey(v) {
  if (!v || !v.make || !v.model) return null;
  return [norm(v.make), norm(v.model), norm(v.engine)].join('|');
}
const engineLabel = (v) => `${v.make} ${v.model}${v.engine ? ' ' + v.engine : ''}`;
// Key for matching an ECU name across cars/shops: "Bosch MED17.5.5" and "bosch med 17.5.5" are the same ECU type.
const ecuKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i);
  return +(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)).toFixed(3);
}
function stats(values) {
  const v = values.map((x) => x.v).filter(Number.isFinite).sort((a, b) => a - b);
  return { n: v.length, vehicles: new Set(values.map((x) => x.car)).size, p10: percentile(v, 0.1), p50: percentile(v, 0.5), p90: percentile(v, 0.9) };
}

// rows: [{ car, kind, summary }] for one engine. `car` is any id that is unique per vehicle (tenant:vehicle).
// Live scans teach typical averages; pulls (full-throttle runs) teach typical peaks.
function learnProfile(rows) {
  const avg = {}; const peak = {}; const meta = {};
  for (const r of rows) {
    for (const [pid, s] of Object.entries(r.summary || {})) {
      if (!s || typeof s !== 'object') continue;
      meta[pid] = meta[pid] || { name: s.name, unit: s.unit };
      if (r.kind === 'pull') { if (Number.isFinite(s.max)) (peak[pid] = peak[pid] || []).push({ v: s.max, car: r.car }); }
      else if (Number.isFinite(s.avg)) (avg[pid] = avg[pid] || []).push({ v: s.avg, car: r.car });
    }
  }
  const build = (src) => Object.fromEntries(Object.entries(src).map(([pid, vals]) => [pid, { ...meta[pid], ...stats(vals) }]));
  return {
    scans: rows.filter((r) => r.kind !== 'pull').length, pulls: rows.filter((r) => r.kind === 'pull').length,
    vehicles: new Set(rows.map((r) => r.car)).size, typical: build(avg), peaks: build(peak),
  };
}

// Is this scan normal for its engine? Only judged where the profile has enough evidence.
const MIN_SCANS = 5, MIN_VEHICLES = 2;
function compareToProfile(profile, summary, { kind = 'live' } = {}) {
  const ref = kind === 'pull' ? profile.peaks : profile.typical;
  const out = [];
  for (const [pid, s] of Object.entries(summary || {})) {
    const p = ref[pid]; const v = kind === 'pull' ? s.max : s.avg;
    if (!Number.isFinite(v)) continue;
    if (!p) { out.push({ pid, name: s.name, unit: s.unit, value: v, typical: null, low: null, high: null, basedOn: 0, status: 'learning' }); continue; }
    const enough = p.n >= MIN_SCANS && p.vehicles >= MIN_VEHICLES;
    const spread = Math.max(p.p90 - p.p10, Math.abs(p.p50) * 0.05, 0.5);
    const lo = p.p10 - spread * 0.25, hi = p.p90 + spread * 0.25;
    out.push({ pid, name: s.name || p.name, unit: s.unit || p.unit, value: v, typical: p.p50, low: p.p10, high: p.p90, basedOn: p.n,
      status: !enough ? 'learning' : v < lo ? 'low' : v > hi ? 'high' : 'normal' });
  }
  return out;
}

// Checks that apply to every petrol/diesel engine, no learning needed.
function universalChecks(summary = {}) {
  const f = [];
  const get = (pid) => summary[pid];
  for (const [pid, label] of [['0106', 'Short-term fuel trim bank 1'], ['0107', 'Long-term fuel trim bank 1'], ['0108', 'Short-term fuel trim bank 2'], ['0109', 'Long-term fuel trim bank 2']]) {
    const s = get(pid); if (!s || !Number.isFinite(s.avg)) continue;
    const a = Math.abs(s.avg);
    if (a > 20) f.push({ level: 'fail', text: `${label} averages ${s.avg.toFixed(1)}% — the ECU is correcting hard. Find the cause (${s.avg > 0 ? 'lean: vacuum/boost leak, MAF, fuel pressure' : 'rich: injectors, fuel pressure, O2 sensor'}) before tuning.` });
    else if (a > 10) f.push({ level: 'warn', text: `${label} averages ${s.avg.toFixed(1)}% (normal is within ±10%).` });
  }
  const cool = get('0105');
  if (cool && Number.isFinite(cool.max) && cool.max < 70) f.push({ level: 'warn', text: `Coolant only reached ${Math.round(cool.max)} °C — warm the engine up before judging it (or check the thermostat).` });
  if (cool && Number.isFinite(cool.max) && cool.max > 110) f.push({ level: 'fail', text: `Coolant reached ${Math.round(cool.max)} °C — overheating. Fix cooling before any tuning.` });
  const iat = get('010F');
  if (iat && Number.isFinite(iat.max) && iat.max > 65) f.push({ level: 'warn', text: `Intake air reached ${Math.round(iat.max)} °C — heat soak or intercooler issue; it costs power and raises knock risk.` });
  const batt = get('0142');
  if (batt && Number.isFinite(batt.min) && batt.min < 12.2) f.push({ level: 'warn', text: `Supply voltage dropped to ${batt.min.toFixed(1)} V. Use a battery support unit when flashing an ECU.` });
  if (batt && Number.isFinite(batt.max) && batt.max > 15) f.push({ level: 'warn', text: `Supply voltage reached ${batt.max.toFixed(1)} V — check the charging system.` });
  return f;
}

// Rough engine power from peak airflow on a full-throttle pull (petrol, ~stoichiometric to rich).
// Crank kW ≈ 0.93 × MAF g/s. Typically within ±15 %; far better for before/after comparison than as an absolute.
const powerFromMaf = (gps) => (Number.isFinite(gps) ? Math.round(gps * 0.93) : null);

function pullPeaks(summary = {}) {
  const max = (pid) => (summary[pid] && Number.isFinite(summary[pid].max) ? summary[pid].max : null);
  const baro = summary['0133'] && Number.isFinite(summary['0133'].avg) ? summary['0133'].avg : 101;
  const map = max('010B');
  return {
    rpm: max('010C'), mapKpa: map, boostBar: map != null ? +((map - baro) / 100).toFixed(2) : null,
    mafGs: max('0110'), timingDeg: max('010E'), iatC: max('010F'), load: max('0104'),
    estKw: powerFromMaf(max('0110')),
  };
}

// Full-throttle pull analysis: a "virtual dyno" curve plus the warnings a tuner looks for.
// samples: [{ t, '010C': rpm, '0110': maf g/s, '010B': map kPa, '010E': timing, '010F': iat, '0144': lambda, '0111': throttle }]
// Power is estimated from airflow (petrol, ±15 %) — reliable for before/after on the same car, not as an absolute figure.
function analysePull(samples = [], summary = {}) {
  const baro = summary['0133'] && Number.isFinite(summary['0133'].avg) ? summary['0133'].avg : 101;
  const thr = (x) => (Number.isFinite(x['0111']) ? x['0111'] : Number.isFinite(x['0149']) ? x['0149'] : null);
  let pts = samples.filter((x) => Number.isFinite(x['010C'])).sort((a, b) => a.t - b.t);
  // only full-throttle samples count: drops the lift-off readings the recorder keeps to confirm the pull ended
  if (pts.some((x) => thr(x) != null)) pts = pts.filter((x) => thr(x) == null || thr(x) >= 80);
  // Skip the tip-in: the first ~300 ms after the throttle snaps open (sensors read a moment before it opened, timing
  // settling), then start where rpm begins to climb.
  if (pts.length > 6) {
    const t0 = pts[0].t; const settled = pts.filter((x) => x.t >= t0 + 300);
    if (settled.length >= 3) pts = settled;
    let lo = 0; for (let i = 1; i < pts.length && i < pts.length / 3; i++) if (pts[i]['010C'] < pts[lo]['010C']) lo = i;
    pts = pts.slice(lo);
  }
  const warnings = [];
  if (pts.length < 3) return { curve: [], peak: null, warnings: [{ level: 'info', text: 'Too few samples for a curve. Use fewer sensors for a faster sample rate.' }], rpmFrom: null, rpmTo: null };
  // curve: highest reading per 250 rpm bin
  const bins = new Map();
  for (const x of pts) {
    const bin = Math.round(x['010C'] / 250) * 250;
    const kw = powerFromMaf(x['0110']);
    const cur = bins.get(bin) || { rpm: bin, kw: null, nm: null, boostBar: null, timing: null, lambda: null };
    if (kw != null && (cur.kw == null || kw > cur.kw)) { cur.kw = kw; cur.nm = Math.round((kw * 9549) / Math.max(bin, 500)); }
    if (Number.isFinite(x['010B'])) cur.boostBar = Math.max(cur.boostBar ?? -9, +((x['010B'] - baro) / 100).toFixed(2));
    if (Number.isFinite(x['010E'])) cur.timing = Math.max(cur.timing ?? -99, x['010E']);
    if (Number.isFinite(x['0144'])) cur.lambda = Math.max(cur.lambda ?? 0, x['0144']);
    bins.set(bin, cur);
  }
  const curve = [...bins.values()].sort((a, b) => a.rpm - b.rpm);
  const withKw = curve.filter((c) => c.kw != null);
  const peakP = withKw.reduce((m, c) => (!m || c.kw > m.kw ? c : m), null);
  const peakT = withKw.reduce((m, c) => (!m || c.nm > m.nm ? c : m), null);
  const rpmFrom = pts[0]['010C'], rpmTo = Math.max(...pts.map((x) => x['010C']));
  if (rpmTo - Math.min(...pts.map((x) => x['010C'])) < 2000) warnings.push({ level: 'info', text: 'The pull covered less than 2,000 rpm. Start lower (about 2,000 rpm) in a higher gear for a full curve.' });
  // knock retard: timing falls 3°+ below the recent maximum while rpm keeps climbing
  const knock = [];
  for (let i = 2; i < pts.length; i++) {
    const t = pts[i]['010E']; const prev = [pts[i - 1]['010E'], pts[i - 2]['010E']].filter(Number.isFinite);
    if (!Number.isFinite(t) || !prev.length) continue;
    const drop = Math.max(...prev) - t;
    if (drop >= 3 && pts[i]['010C'] >= pts[i - 1]['010C']) knock.push({ rpm: Math.round(pts[i]['010C']), drop: +drop.toFixed(1) });
  }
  if (knock.length) warnings.push({ level: 'fail', text: `Possible knock: ignition timing pulled back ${knock.map((k) => `${k.drop}° at ${k.rpm} rpm`).slice(0, 4).join(', ')}. Check fuel octane, intake temperature and the tune's timing at those points.`, knock });
  // commanded mixture under boost
  const boosted = pts.filter((x) => Number.isFinite(x['010B']) && x['010B'] - baro > 20);
  const lam = boosted.map((x) => x['0144']).filter(Number.isFinite);
  if (lam.length && Math.max(...lam) > 0.95) warnings.push({ level: 'fail', text: `Commanded mixture is λ ${Math.max(...lam).toFixed(2)} under boost — too lean for full load on a turbo petrol (usually λ 0.78–0.88).` });
  // intake heat soak
  const iat = pts.map((x) => x['010F']).filter(Number.isFinite);
  if (iat.length >= 2 && iat[iat.length - 1] - iat[0] >= 15) warnings.push({ level: 'warn', text: `Intake air rose ${Math.round(iat[iat.length - 1] - iat[0])} °C during the pull — intercooler efficiency or heat soak is costing power.` });
  // boost taper at the top end
  const bc = curve.filter((c) => c.boostBar != null);
  if (bc.length >= 3) {
    const peakB = Math.max(...bc.map((c) => c.boostBar)); const end = bc[bc.length - 1].boostBar;
    if (peakB > 0.3 && peakB - end > 0.4) warnings.push({ level: 'info', text: `Boost falls from ${peakB} to ${end} bar by ${bc[bc.length - 1].rpm} rpm. Normal for small turbos; a sudden drop can be a boost leak or wastegate.` });
  }
  return {
    curve, rpmFrom: Math.round(rpmFrom), rpmTo: Math.round(rpmTo), warnings,
    peak: peakP ? { kw: peakP.kw, kwRpm: peakP.rpm, nm: peakT.nm, nmRpm: peakT.rpm } : null,
  };
}

function comparePulls(before, after) {
  const a = pullPeaks(before.summary), b = pullPeaks(after.summary);
  const rows = [
    ['estKw', 'Estimated power (from airflow)', 'kW'], ['mafGs', 'Peak airflow', 'g/s'], ['boostBar', 'Peak boost', 'bar'],
    ['mapKpa', 'Peak manifold pressure', 'kPa'], ['timingDeg', 'Peak ignition advance', '°'], ['iatC', 'Peak intake air temp', '°C'],
    ['load', 'Peak engine load', '%'], ['rpm', 'Peak RPM', 'rpm'],
  ].filter(([k]) => a[k] != null || b[k] != null).map(([k, label, unit]) => {
    const d = a[k] != null && b[k] != null ? +(b[k] - a[k]).toFixed(2) : null;
    return { key: k, label, unit, before: a[k], after: b[k], change: d, pct: d != null && a[k] ? Math.round((d / Math.abs(a[k])) * 100) : null };
  });
  const ca = analysePull(before.samples || [], before.summary || {}), cb = analysePull(after.samples || [], after.summary || {});
  return { before: { id: before.id, at: before.started_at, curve: ca.curve, peak: ca.peak }, after: { id: after.id, at: after.started_at, curve: cb.curve, peak: cb.peak }, rows };
}

// What the shop has learned about ECU software for this engine.
// scans: [{ car, at, calids: [], cvns: [] }], remaps: [{ car, at }] (both for one engine).
// A software version = calibration ID + its checksum (CVN): tuners often keep the ID and only the checksum changes.
// The version read just before a logged remap is voted "stock"; a different version read after it is voted "tuned".
const versions = (s) => (s.calids || []).map((c, i) => ({ calid: c, cvn: (s.cvns || [])[i] || null }));
const vkey = (v) => `${v.calid}|${v.cvn || ''}`;
const sameSoftware = (a, b) => versions(a).map(vkey).join() === versions(b).map(vkey).join();
function learnCalibrations(scans, remaps) {
  const book = new Map();
  const entry = (v) => book.get(vkey(v)) || book.set(vkey(v), { ...v, cars: new Set(), stock: 0, tuned: 0 }).get(vkey(v));
  const byCar = new Map();
  for (const s of scans) (byCar.get(s.car) || byCar.set(s.car, []).get(s.car)).push(s);
  for (const [car, list] of byCar) {
    list.sort((x, y) => String(x.at).localeCompare(String(y.at)));
    for (const s of list) versions(s).forEach((v) => entry(v).cars.add(car));
    for (const r of remaps.filter((m) => m.car === car)) {
      const pre = [...list].reverse().find((s) => String(s.at) <= String(r.at));
      const post = list.find((s) => String(s.at) > String(r.at));
      if (!pre || !post || sameSoftware(pre, post)) continue;
      const before = new Set(versions(pre).map(vkey));
      versions(pre).forEach((v) => { entry(v).stock++; });
      versions(post).filter((v) => !before.has(vkey(v))).forEach((v) => { entry(v).tuned++; });
    }
  }
  return [...book.values()].map((e) => ({
    calid: e.calid, cvn: e.cvn, vehicles: e.cars.size,
    label: e.tuned > e.stock ? 'tuned' : e.stock > 0 ? 'stock' : 'unknown',
  })).sort((x, y) => y.vehicles - x.vehicles || x.calid.localeCompare(y.calid));
}

// Has the ECU software changed between this car's last two identification reads?
function softwareChange(carScans) {
  const reads = carScans.filter((s) => (s.calids || []).length).sort((x, y) => String(x.at).localeCompare(String(y.at)));
  if (reads.length < 2) return null;
  const [prev, cur] = reads.slice(-2);
  return sameSoftware(prev, cur) ? null : { since: prev.at, at: cur.at, before: versions(prev), now: versions(cur) };
}

// Is this car in a fit state to tune? Built from its latest data.
function tuneReadiness({ openDtcs = 0, readiness = null, monitorTests = null, summary = null, hasScan = false }) {
  const checks = [];
  checks.push({ ok: openDtcs === 0, text: openDtcs ? `${openDtcs} open fault code${openDtcs === 1 ? '' : 's'} — fix before tuning` : 'No open fault codes' });
  if (readiness) {
    const notReady = (readiness.monitors || []).filter((m) => !m.ready).length;
    checks.push({ ok: !readiness.mil && notReady === 0, text: readiness.mil ? 'Warning light is ON' : notReady ? `${notReady} readiness monitor${notReady === 1 ? '' : 's'} not complete` : 'Warning light off, all monitors ready' });
  } else checks.push({ ok: null, text: 'Readiness not read yet (Fault codes → Readiness & MIL)' });
  if (monitorTests) {
    const failed = monitorTests.filter((t) => !t.pass).length;
    checks.push({ ok: failed === 0, text: failed ? `${failed} on-board monitor test${failed === 1 ? '' : 's'} failed` : 'All on-board monitor tests passed' });
  } else checks.push({ ok: null, text: 'Monitor tests not read yet (Fault codes → Monitor tests)' });
  if (hasScan) {
    const bad = universalChecks(summary || {});
    checks.push({ ok: !bad.some((b) => b.level === 'fail') && bad.length === 0, text: bad.length ? `${bad.length} health warning${bad.length === 1 ? '' : 's'} on the last live scan` : 'Last live scan looks healthy (fuel trims, temperatures, voltage)' });
  } else checks.push({ ok: null, text: 'No live scan yet — run one with the engine warm' });
  const verdict = checks.some((c) => c.ok === false) ? 'not_ready' : checks.some((c) => c.ok === null) ? 'incomplete' : 'ready';
  return { verdict, checks };
}

module.exports = { engineKey, engineLabel, ecuKey, learnProfile, compareToProfile, universalChecks, pullPeaks, analysePull, comparePulls, powerFromMaf, learnCalibrations, softwareChange, tuneReadiness, MIN_SCANS, MIN_VEHICLES };
