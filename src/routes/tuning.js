// Tuning section: learned engine profiles, ECU software knowledge, tune readiness and before/after pull comparison.
// Learning uses this workshop's own scans. If the workshop opts in (Settings → Engine learning), it also uses the
// pooled data of other opted-in workshops — only ever returned as aggregates (no vehicles, customers or VINs).
const express = require('express');
const db = require('../db');
const { wrap, HttpError } = require('../lib/http');
const { parseId } = require('../lib/crud');
const L = require('../lib/engine-learning');

const router = express.Router();

// Documentation vocabulary. These describe how an ECU is worked on; the app performs none of it.
const ACCESS = ['obd', 'bench', 'boot', 'unknown'];
const LEGAL = ['road', 'track', 'check'];

// Own ECU notes, plus (when both shops opt in) an anonymised, aggregated reference built from other shops' notes.
// ECU notes are about ECU TYPES, never about a customer or vehicle, so nothing identifying is pooled.
async function loadEcuReference(tenantId, keys = null) {
  const shared = await sharing(tenantId);
  const own = (await db.query('SELECT * FROM ecu_profiles WHERE tenant_id = $1', [tenantId])).rows;
  const others = shared
    ? (await db.query(`SELECT ep.* FROM ecu_profiles ep JOIN tenants t ON t.id = ep.tenant_id WHERE ep.tenant_id <> $1 AND t.share_engine_data = true`, [tenantId])).rows
    : [];
  const want = keys && keys.length ? new Set(keys) : null;
  const byKey = new Map();
  const add = (r, mine) => {
    if (want && !want.has(r.ecu_key)) return;
    const g = byKey.get(r.ecu_key) || byKey.set(r.ecu_key, { ecu_key: r.ecu_key, ecu_name: r.ecu_name, make: r.make || null, shops: new Set(), entries: new Map() }).get(r.ecu_key);
    if (mine) g.ecu_name = r.ecu_name;
    g.shops.add(mine ? `me` : `t${r.tenant_id}`);
    const sig = [r.access_method, (r.tool || '').toLowerCase().trim(), r.road_legal].join('|');
    const e = g.entries.get(sig) || g.entries.set(sig, { access_method: r.access_method, tool: r.tool || null, road_legal: r.road_legal, security_note: r.security_note || null, notes: r.notes || null, mine: false, shops: 0 }).get(sig);
    e.shops++; if (mine) { e.mine = true; e.security_note = r.security_note || e.security_note; e.notes = r.notes || e.notes; }
  };
  own.forEach((r) => add(r, true));
  others.forEach((r) => add(r, false));
  const reference = [...byKey.values()].map((g) => ({ ecu_key: g.ecu_key, ecu_name: g.ecu_name, make: g.make, shops: g.shops.size, entries: [...g.entries.values()] }))
    .sort((a, b) => b.shops - a.shops || a.ecu_name.localeCompare(b.ecu_name));
  return { shared, own, reference };
}

function cleanEcuProfile(body) {
  const name = typeof body.ecu_name === 'string' ? body.ecu_name.trim().slice(0, 80) : '';
  if (!name) throw new HttpError(400, 'ECU name is required');
  const pick = (v, allowed, def) => (allowed.includes(v) ? v : def);
  const txt = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return {
    ecu_name: name, ecu_key: L.ecuKey(name), make: txt(body.make, 60),
    access_method: pick(body.access_method, ACCESS, 'unknown'), tool: txt(body.tool, 60),
    security_note: txt(body.security_note, 400), road_legal: pick(body.road_legal, LEGAL, 'check'), notes: txt(body.notes, 2000),
  };
}

const iso = (d) => (d instanceof Date ? d.toISOString() : String(d));
const ymd = (d) => iso(d).slice(0, 10);

async function sharing(tenantId) {
  const { rows } = await db.query('SELECT share_engine_data FROM tenants WHERE id = $1', [tenantId]);
  return !!(rows[0] && rows[0].share_engine_data);
}

// Every scan and remap the learning may use, tagged with its engine key.
async function loadKnowledge(tenantId) {
  const shared = await sharing(tenantId);
  const scope = `(x.tenant_id = $1 OR ($2::boolean AND t.share_engine_data))`;
  const [scans, remaps] = await Promise.all([
    db.query(`SELECT x.id, x.tenant_id, x.vehicle_id, x.kind, x.summary, x.ecu_info, x.started_at, v.make, v.model, v.engine
                FROM scan_sessions x JOIN vehicles v ON v.id = x.vehicle_id AND v.tenant_id = x.tenant_id JOIN tenants t ON t.id = x.tenant_id
               WHERE x.source = 'adapter' AND (x.summary IS NOT NULL OR x.ecu_info IS NOT NULL) AND ${scope}
               ORDER BY x.id DESC LIMIT 20000`, [tenantId, shared]),
    db.query(`SELECT x.tenant_id, x.vehicle_id, x.done_on, x.created_at, v.make, v.model, v.engine
                FROM remaps x JOIN vehicles v ON v.id = x.vehicle_id AND v.tenant_id = x.tenant_id JOIN tenants t ON t.id = x.tenant_id
               WHERE ${scope}`, [tenantId, shared]),
  ]);
  const car = (r) => `${r.tenant_id}:${r.vehicle_id}`;
  return {
    shared,
    scans: scans.rows.map((r) => ({
      id: r.id, own: r.tenant_id === tenantId, car: car(r), key: L.engineKey(r), label: L.engineLabel(r), kind: r.kind,
      summary: r.summary, at: iso(r.started_at), calids: (r.ecu_info && r.ecu_info.calids) || [], cvns: (r.ecu_info && r.ecu_info.cvns) || [],
    })),
    // A remap logged today happened at the moment it was logged; one back-dated happened mid-day on that date.
    remaps: remaps.rows.map((r) => ({
      car: car(r), key: L.engineKey(r), at: ymd(r.created_at) === ymd(r.done_on) ? iso(r.created_at) : `${ymd(r.done_on)}T12:00:00.000Z`,
    })),
  };
}

// The engine library: every engine the system has learned about.
router.get('/engines', wrap(async (req, res) => {
  const k = await loadKnowledge(req.user.tenantId);
  const byKey = new Map();
  for (const s of k.scans) {
    if (!s.key) continue;
    const e = byKey.get(s.key) || byKey.set(s.key, { key: s.key, label: s.label, cars: new Set(), ownCars: new Set(), scans: 0, pulls: 0, calids: new Set() }).get(s.key);
    if (s.own) { e.label = s.label; e.ownCars.add(s.car); }
    e.cars.add(s.car);
    if (s.summary) s.kind === 'pull' ? e.pulls++ : e.scans++;
    s.calids.forEach((c) => e.calids.add(c));
  }
  res.json({
    shared: k.shared,
    engines: [...byKey.values()].map((e) => ({ key: e.key, label: e.label, vehicles: e.cars.size, yourVehicles: e.ownCars.size, scans: e.scans, pulls: e.pulls, calibrations: e.calids.size,
      learned: e.scans >= L.MIN_SCANS && e.cars.size >= L.MIN_VEHICLES }))
      .filter((e) => e.yourVehicles > 0 || e.vehicles >= 3) // other shops' engines only once several cars back them
      .sort((a, b) => b.vehicles - a.vehicles || a.label.localeCompare(b.label)),
  });
}));

// Everything the Tuning page shows for one vehicle.
router.get('/vehicle/:id', wrap(async (req, res) => {
  const t = req.user.tenantId; const id = parseId(req.params.id);
  const veh = (await db.query('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2', [id, t])).rows[0];
  if (!veh) throw new HttpError(404, 'Not found');
  const key = L.engineKey(veh);
  const [k, dtcs, mine] = await Promise.all([
    loadKnowledge(t),
    db.query(`SELECT COUNT(*)::int AS n FROM dtc_events WHERE tenant_id = $1 AND vehicle_id = $2 AND status IN ('active','pending')`, [t, id]),
    db.query(`SELECT id, kind, summary, readiness, monitor_tests, ecu_info, started_at FROM scan_sessions
               WHERE tenant_id = $1 AND vehicle_id = $2 AND source = 'adapter' ORDER BY started_at DESC, id DESC LIMIT 200`, [t, id]),
  ]);
  const engineScans = k.scans.filter((s) => s.key === key);
  const thisCar = `${t}:${id}`;
  // the car being judged is left out of its own reference, so it isn't compared with itself
  const profile = L.learnProfile(engineScans.filter((s) => s.summary && s.car !== thisCar));
  const latest = (pred) => mine.rows.find(pred) || null;
  const live = latest((s) => s.summary && s.kind !== 'pull');
  const pull = latest((s) => s.summary && s.kind === 'pull');
  const readiness = latest((s) => s.readiness);
  const tests = latest((s) => Array.isArray(s.monitor_tests) && s.monitor_tests.length);
  const ecu = latest((s) => s.ecu_info);
  const calibrations = L.learnCalibrations(engineScans.filter((s) => s.calids.length), k.remaps.filter((r) => r.key === key));
  const current = ecu ? (ecu.ecu_info.calids || []).map((c, i) => ({ calid: c, cvn: (ecu.ecu_info.cvns || [])[i] || null })) : [];
  const known = (v) => calibrations.find((c) => c.calid === v.calid && (c.cvn || null) === (v.cvn || null));
  const change = L.softwareChange(engineScans.filter((s) => s.car === thisCar));
  const remapLogged = change ? k.remaps.some((r) => r.car === thisCar && r.at > change.since && r.at <= change.at) : false;
  res.json({
    vehicle: { id: veh.id, make: veh.make, model: veh.model, engine: veh.engine, year: veh.year, plate: veh.plate },
    engine: { key, label: L.engineLabel(veh), vehicles: profile.vehicles, scans: profile.scans, pulls: profile.pulls, shared: k.shared,
      learned: profile.scans >= L.MIN_SCANS && profile.vehicles >= L.MIN_VEHICLES, needs: { scans: L.MIN_SCANS, vehicles: L.MIN_VEHICLES } },
    health: live ? { scanId: live.id, at: live.started_at, vsEngine: L.compareToProfile(profile, live.summary), checks: L.universalChecks(live.summary) } : null,
    lastPull: pull ? { scanId: pull.id, at: pull.started_at, peaks: L.pullPeaks(pull.summary), vsEngine: L.compareToProfile(profile, pull.summary, { kind: 'pull' }) } : null,
    readiness: L.tuneReadiness({ openDtcs: dtcs.rows[0].n, readiness: readiness && readiness.readiness, monitorTests: tests && tests.monitor_tests, summary: live && live.summary, hasScan: !!live }),
    software: {
      lastRead: ecu ? { at: ecu.started_at, ...ecu.ecu_info } : null,
      current: current.map((v) => ({ ...v, label: (known(v) || {}).label || 'unknown', seenOn: (known(v) || {}).vehicles || 1 })),
      changed: change ? { ...change, remapLogged } : null,
      knownForEngine: calibrations,
    },
    pulls: mine.rows.filter((s) => s.kind === 'pull' && s.summary).map((s) => ({ id: s.id, at: s.started_at, peaks: L.pullPeaks(s.summary) })),
    ecu: await (async () => {
      const names = (ecu && ecu.ecu_info.names) || [];
      const keys = names.map(L.ecuKey).filter(Boolean);
      const ref = await loadEcuReference(t, keys);
      return { names, reference: ref.reference, shared: ref.shared, documented: ref.own.some((o) => keys.includes(o.ecu_key)) };
    })(),
  });
}));

// --- ECU reference library (documentation only; performs no unlock, flash or bypass) ---
router.get('/ecu', wrap(async (req, res) => {
  const ref = await loadEcuReference(req.user.tenantId);
  res.json({ ...ref, access: ACCESS, legal: LEGAL });
}));

// Create or update this workshop's note for an ECU type (one per ECU name per shop).
router.post('/ecu', wrap(async (req, res) => {
  const v = cleanEcuProfile(req.body || {});
  const { rows } = await db.query(
    `INSERT INTO ecu_profiles (tenant_id, ecu_name, ecu_key, make, access_method, tool, security_note, road_legal, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, ecu_key) DO UPDATE SET
       ecu_name = EXCLUDED.ecu_name, make = EXCLUDED.make, access_method = EXCLUDED.access_method, tool = EXCLUDED.tool,
       security_note = EXCLUDED.security_note, road_legal = EXCLUDED.road_legal, notes = EXCLUDED.notes, updated_at = now()
     RETURNING *`,
    [req.user.tenantId, v.ecu_name, v.ecu_key, v.make, v.access_method, v.tool, v.security_note, v.road_legal, v.notes]);
  res.status(201).json(rows[0]);
}));

router.delete('/ecu/:id', wrap(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM ecu_profiles WHERE id = $1 AND tenant_id = $2', [parseId(req.params.id), req.user.tenantId]);
  if (!rowCount) throw new HttpError(404, 'Not found');
  res.status(204).end();
}));

// Virtual dyno and warnings for one pull.
router.get('/pull/:id', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT id, vehicle_id, started_at, summary, samples FROM scan_sessions WHERE id = $1 AND tenant_id = $2 AND kind = 'pull'`, [parseId(req.params.id), req.user.tenantId]);
  if (!rows[0]) throw new HttpError(404, 'Pull not found');
  res.json({ id: rows[0].id, at: rows[0].started_at, peaks: L.pullPeaks(rows[0].summary), ...L.analysePull(rows[0].samples || [], rows[0].summary || {}) });
}));

// Before/after comparison of two of this workshop's pulls (or live scans).
router.get('/compare', wrap(async (req, res) => {
  const a = parseId(req.query.before), b = parseId(req.query.after);
  const { rows } = await db.query('SELECT id, started_at, summary, samples FROM scan_sessions WHERE tenant_id = $1 AND id IN ($2, $3)', [req.user.tenantId, a, b]);
  const before = rows.find((r) => r.id === a), after = rows.find((r) => r.id === b);
  if (!before || !after) throw new HttpError(404, 'Scan not found');
  res.json(L.comparePulls(before, after));
}));

module.exports = router;
