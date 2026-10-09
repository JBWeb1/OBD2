// Tuning section: learned engine profiles, ECU software knowledge, tune readiness and before/after pull comparison.
// Learning uses this workshop's own scans. If the workshop opts in (Settings → Engine learning), it also uses the
// pooled data of other opted-in workshops — only ever returned as aggregates (no vehicles, customers or VINs).
const express = require('express');
const db = require('../db');
const { wrap, HttpError } = require('../lib/http');
const { parseId } = require('../lib/crud');
const L = require('../lib/engine-learning');

const router = express.Router();
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
  });
}));

// Before/after comparison of two of this workshop's pulls (or live scans).
router.get('/compare', wrap(async (req, res) => {
  const a = parseId(req.query.before), b = parseId(req.query.after);
  const { rows } = await db.query('SELECT id, started_at, summary FROM scan_sessions WHERE tenant_id = $1 AND id IN ($2, $3)', [req.user.tenantId, a, b]);
  const before = rows.find((r) => r.id === a), after = rows.find((r) => r.id === b);
  if (!before || !after) throw new HttpError(404, 'Scan not found');
  res.json(L.comparePulls(before, after));
}));

module.exports = router;
