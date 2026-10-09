const test = require('node:test');
const assert = require('node:assert/strict');
const { start, db } = require('./helpers');
const L = require('../src/lib/engine-learning');

// A live-scan summary as the scanner saves it.
const live = (stft, ltft, extra = {}) => ({
  '010C': { name: 'Engine RPM', unit: 'RPM', min: 780, max: 3100, avg: 1200 },
  '0105': { name: 'Coolant temperature', unit: '°C', min: 82, max: 92, avg: 89 },
  '0106': { name: 'Short-term fuel trim — bank 1', unit: '%', min: stft - 3, max: stft + 3, avg: stft },
  '0107': { name: 'Long-term fuel trim — bank 1', unit: '%', min: ltft, max: ltft, avg: ltft },
  ...extra,
});
const pull = (maf, map, timing = 18) => ({
  '010C': { name: 'Engine RPM', unit: 'RPM', min: 2000, max: 6200, avg: 4100 },
  '0110': { name: 'MAF air flow rate', unit: 'g/s', min: 20, max: maf, avg: maf / 2 },
  '010B': { name: 'Intake manifold pressure', unit: 'kPa', min: 90, max: map, avg: map - 20 },
  '0133': { name: 'Barometric pressure', unit: 'kPa', min: 100, max: 100, avg: 100 },
  '010E': { name: 'Timing advance', unit: '°', min: 2, max: timing, avg: timing / 2 },
  '010F': { name: 'Intake air temperature', unit: '°C', min: 30, max: 42, avg: 35 },
});

test('engine key ignores case and punctuation, so "1.0 TSI" and "1.0 tsi" are the same engine', () => {
  assert.equal(L.engineKey({ make: 'Volkswagen', model: 'Polo', engine: '1.0 TSI' }), L.engineKey({ make: 'volkswagen ', model: 'POLO', engine: '1.0  tsi' }));
  assert.notEqual(L.engineKey({ make: 'VW', model: 'Polo', engine: '1.0 TSI' }), L.engineKey({ make: 'VW', model: 'Polo', engine: '1.4 TSI' }));
  assert.equal(L.engineKey({ make: 'VW' }), null);
});

test('profile learning: typical ranges from live scans, peaks from pulls; judging needs enough evidence', () => {
  const rows = [];
  for (let car = 1; car <= 4; car++) for (let i = 0; i < 2; i++) rows.push({ car, kind: 'live', summary: live(1 + car * 0.5, 2) });
  rows.push({ car: 1, kind: 'pull', summary: pull(90, 210) }, { car: 2, kind: 'pull', summary: pull(95, 215) });
  const p = L.learnProfile(rows);
  assert.equal(p.vehicles, 4); assert.equal(p.scans, 8); assert.equal(p.pulls, 2);
  assert.ok(p.typical['0106'].p50 > 1 && p.typical['0106'].p50 < 3.5);
  assert.equal(p.peaks['0110'].n, 2);
  const cmp = L.compareToProfile(p, live(14, 9));
  assert.equal(cmp.find((c) => c.pid === '0106').status, 'high', 'lean car stands out against its own engine');
  assert.equal(cmp.find((c) => c.pid === '010C').status, 'normal');
  assert.equal(L.compareToProfile(p, pull(120, 240), { kind: 'pull' }).find((c) => c.pid === '0110').status, 'learning', 'two pulls are not enough to judge');
  assert.equal(L.compareToProfile(L.learnProfile(rows.slice(0, 3)), live(14, 9))[0].status, 'learning');
});

test('universal checks work for any model without learning', () => {
  const f = L.universalChecks(live(24, 12, { '0142': { name: 'Battery', unit: 'V', min: 11.8, max: 14.1, avg: 13.6 }, '0105': { min: 60, max: 65, avg: 63 } }));
  assert.ok(f.some((x) => x.level === 'fail' && /Short-term fuel trim/.test(x.text)));
  assert.ok(f.some((x) => x.level === 'warn' && /Long-term fuel trim/.test(x.text)));
  assert.ok(f.some((x) => /battery support/i.test(x.text)));
  assert.ok(f.some((x) => /Coolant only reached 65/.test(x.text)));
  assert.deepEqual(L.universalChecks(live(2, 1)), []);
});

test('pull peaks, boost and power estimate; before/after comparison', () => {
  const pk = L.pullPeaks(pull(100, 220));
  assert.equal(pk.boostBar, 1.2); assert.equal(pk.estKw, 93); assert.equal(pk.rpm, 6200);
  const c = L.comparePulls({ id: 1, summary: pull(100, 220, 16) }, { id: 2, summary: pull(115, 245, 19) });
  const kw = c.rows.find((r) => r.key === 'estKw');
  assert.equal(kw.before, 93); assert.equal(kw.after, 107); assert.equal(kw.change, 14); assert.equal(kw.pct, 15);
  assert.equal(c.rows.find((r) => r.key === 'boostBar').change, 0.25);
});

test('calibration learning: the version before a logged remap is stock, the new one after it is tuned', () => {
  const scans = [
    { car: 'a', at: '2026-01-01T08:00', calids: ['04E906023AB'], cvns: ['11111111'] },
    { car: 'a', at: '2026-01-01T15:00', calids: ['04E906023AB'], cvns: ['22222222'] }, // same ID, new checksum
    { car: 'b', at: '2026-02-01T08:00', calids: ['04E906023AB'], cvns: ['11111111'] },
    { car: 'c', at: '2026-03-01T08:00', calids: ['04E906023AB'], cvns: ['22222222'] },
  ];
  const book = L.learnCalibrations(scans, [{ car: 'a', at: '2026-01-01T12:00' }]);
  const stock = book.find((c) => c.cvn === '11111111'), tuned = book.find((c) => c.cvn === '22222222');
  assert.equal(stock.label, 'stock'); assert.equal(stock.vehicles, 2);
  assert.equal(tuned.label, 'tuned'); assert.equal(tuned.vehicles, 2, 'car c is recognised as running the tuned file');
  assert.deepEqual(L.softwareChange(scans.filter((s) => s.car === 'a')).now, [{ calid: '04E906023AB', cvn: '22222222' }]);
  assert.equal(L.softwareChange(scans.filter((s) => s.car === 'b')), null);
});

test('tune readiness verdict', () => {
  assert.equal(L.tuneReadiness({ openDtcs: 0, readiness: { mil: false, monitors: [{ ready: true }] }, monitorTests: [{ pass: true }], summary: live(1, 1), hasScan: true }).verdict, 'ready');
  assert.equal(L.tuneReadiness({ openDtcs: 1, hasScan: true, summary: live(1, 1) }).verdict, 'not_ready');
  assert.equal(L.tuneReadiness({ openDtcs: 0, hasScan: false }).verdict, 'incomplete');
});

// ---------------- API ----------------
let ctx, A, B, C;
test.before(async () => {
  ctx = await start();
  A = await ctx.register('Tune A', 'ta@x.com'); B = await ctx.register('Tune B', 'tb@x.com'); C = await ctx.register('Tune C', 'tc@x.com');
});
test.after(() => ctx.close());
const car = async (token, engine = '1.0 TSI') => (await ctx.call('POST', '/vehicles', { token, body: { make: 'Volkswagen', model: 'Polo', engine } })).body.id;
const scan = (token, body) => ctx.call('POST', '/scans', { token, body: { protocol: 'CAN', ...body } });

test('API: the shop learns its engines from scans and flags a car that is off for its engine', async () => {
  for (let i = 0; i < 3; i++) { const v = await car(A); await scan(A, { vehicle_id: v, summary: live(1 + i, 2) }); await scan(A, { vehicle_id: v, summary: live(2, 1 + i) }); }
  const lean = await car(A, '1.0 tsi');
  await scan(A, { vehicle_id: lean, summary: live(15, 12) });
  const r = (await ctx.call('GET', `/tuning/vehicle/${lean}`, { token: A })).body;
  assert.equal(r.engine.vehicles, 3, 'the car is not compared with itself'); assert.equal(r.engine.learned, true);
  assert.equal(r.health.vsEngine.find((x) => x.pid === '0106').status, 'high');
  assert.ok(r.health.checks.some((c) => c.level === 'warn'));
  assert.equal(r.readiness.verdict, 'not_ready');
  const lib = (await ctx.call('GET', '/tuning/engines', { token: A })).body;
  assert.equal(lib.engines[0].label, 'Volkswagen Polo 1.0 TSI'); assert.equal(lib.engines[0].yourVehicles, 4);
  assert.equal((await ctx.call('GET', `/tuning/vehicle/${lean}`, { token: B })).status, 404, 'other shops cannot open it');
});

test('API: pulling the ECU software teaches stock vs tuned, and a later car is recognised', async () => {
  const v = await car(A, '2.0 TDI');
  const s1 = (await scan(A, { vehicle_id: v, ecu_info: { calids: ['03L906018JL', '<script>'], cvns: ['AAAA1111', 'nothex'], names: ['ECM-EngineControl'], vin: 'WVWZZZ6RZHY123456' } })).body;
  assert.deepEqual(s1.ecu_info.calids, ['03L906018JL', '<script>'].filter((c) => /^[\x20-\x7E]{1,16}$/.test(c)));
  assert.deepEqual(s1.ecu_info.cvns, ['AAAA1111'], 'malformed checksum dropped');
  assert.equal((await scan(A, { vehicle_id: v, ecu_info: 'x' })).status, 400);
  await db.query(`UPDATE scan_sessions SET started_at = '2026-01-10 08:00:00' WHERE id = $1`, [s1.id]);
  const rm = (await ctx.call('POST', '/remaps', { token: A, body: { vehicle_id: v, stage: 'Stage 1', done_on: '2026-01-10' } })).body;
  await db.query(`UPDATE remaps SET created_at = '2026-01-10 12:00:00' WHERE id = $1`, [rm.id]);
  const s2 = (await scan(A, { vehicle_id: v, ecu_info: { calids: ['03L906018JL', '<script>'], cvns: ['BBBB2222'] } })).body;
  await db.query(`UPDATE scan_sessions SET started_at = '2026-01-10 16:00:00' WHERE id = $1`, [s2.id]);
  const r = (await ctx.call('GET', `/tuning/vehicle/${v}`, { token: A })).body;
  assert.equal(r.software.changed.remapLogged, true);
  assert.equal(r.software.current[0].label, 'tuned');
  assert.equal(r.software.knownForEngine.find((c) => c.cvn === 'AAAA1111').label, 'stock');
  // a different customer's car arrives already running that file
  const other = await car(A, '2.0 TDI');
  await scan(A, { vehicle_id: other, ecu_info: { calids: ['03L906018JL'], cvns: ['BBBB2222'] } });
  const o = (await ctx.call('GET', `/tuning/vehicle/${other}`, { token: A })).body;
  assert.equal(o.software.current[0].label, 'tuned');
  // software changed with no remap logged -> flagged as such
  const s3 = (await scan(A, { vehicle_id: v, ecu_info: { calids: ['03L906018JL', '<script>'], cvns: ['CCCC3333'] } })).body;
  await db.query(`UPDATE scan_sessions SET started_at = '2026-05-01 09:00:00' WHERE id = $1`, [s3.id]);
  assert.equal((await ctx.call('GET', `/tuning/vehicle/${v}`, { token: A })).body.software.changed.remapLogged, false);
});

test('API: pulls are stored as pulls and compared before/after', async () => {
  const v = await car(A, '1.4 TSI');
  const before = (await scan(A, { vehicle_id: v, kind: 'pull', summary: pull(100, 220, 16) })).body;
  const after = (await scan(A, { vehicle_id: v, kind: 'pull', summary: pull(118, 250, 19) })).body;
  assert.equal(before.kind, 'pull');
  const r = (await ctx.call('GET', `/tuning/vehicle/${v}`, { token: A })).body;
  assert.equal(r.pulls.length, 2); assert.equal(r.lastPull.peaks.estKw, 110);
  const c = (await ctx.call('GET', `/tuning/compare?before=${before.id}&after=${after.id}`, { token: A })).body;
  assert.equal(c.rows.find((x) => x.key === 'estKw').change, 17);
  assert.equal((await ctx.call('GET', `/tuning/compare?before=${before.id}&after=${after.id}`, { token: B })).status, 404);
  assert.equal((await ctx.call('GET', '/scans/usage', { token: A })).body.used >= 2, true, 'pulls are live scans for plan limits');
});

test('API: shared learning is opt-in for both sides and only ever returns aggregates', async () => {
  for (let i = 0; i < 3; i++) await scan(B, { vehicle_id: await car(B, '1.6 MPI'), summary: live(2, 2), ecu_info: { calids: ['SECRETB'] } });
  const mine = await car(C, '1.6 MPI'); await scan(C, { vehicle_id: mine, summary: live(3, 3) });
  const view = async () => (await ctx.call('GET', `/tuning/vehicle/${mine}`, { token: C })).body;
  assert.equal((await view()).engine.vehicles, 0, 'nothing shared by default');
  await ctx.call('PUT', '/shop', { token: C, body: { share_engine_data: true } });
  assert.equal((await view()).engine.vehicles, 0, 'B has not opted in');
  await ctx.call('PUT', '/shop', { token: B, body: { share_engine_data: true } });
  const v = await view();
  assert.equal(v.engine.vehicles, 3); assert.equal(v.engine.shared, true);
  const raw = JSON.stringify(v);
  const bIds = (await db.query(`SELECT v.id FROM vehicles v JOIN tenants t ON t.id = v.tenant_id WHERE t.name = 'Tune B'`)).rows.map((r) => r.id);
  for (const id of bIds) assert.ok(!raw.includes(`"vehicle_id":${id}`) && !raw.includes(`"id":${id},"make"`), 'no other-shop vehicle records');
  const lib = (await ctx.call('GET', '/tuning/engines', { token: C })).body.engines;
  assert.equal(lib.find((e) => e.label.includes('1.6 MPI')).vehicles, 4);
  assert.equal((await ctx.call('GET', '/tuning/engines', { token: A })).body.engines.some((e) => e.label.includes('1.6 MPI')), false, 'A did not opt in');
});

// A synthetic 2,000 -> 6,000 rpm pull. `knockAt` pulls 5° of timing at that rpm; `lambda` is the commanded mixture.
function pullSamples({ knockAt = null, lambda = 0.82, iatRise = 5, mafScale = 1 } = {}) {
  const out = [];
  for (let i = 0; i <= 40; i++) {
    const rpm = 2000 + i * 100;
    const timing = 8 + i * 0.25 - (knockAt && Math.abs(rpm - knockAt) < 50 ? 5 : 0);
    out.push({ t: i * 150, '010C': rpm, '0110': (20 + i * 2.5) * mafScale, '010B': 220 - Math.max(0, i - 30) * 6, '010E': timing, '010F': 30 + (iatRise * i) / 40, '0144': lambda, '0111': 100 });
  }
  return out;
}

test('pull analysis: dyno curve, peak power/torque, knock, lean mixture, heat soak, boost taper', () => {
  const ok = L.analysePull(pullSamples(), {});
  assert.equal(ok.rpmFrom, 2200, 'first 300 ms (tip-in) skipped'); assert.equal(ok.rpmTo, 6000);
  assert.ok(ok.curve.length >= 15);
  assert.equal(ok.peak.kwRpm, 6000); assert.equal(ok.peak.kw, L.powerFromMaf(120));
  assert.ok(ok.peak.nm > 0);
  assert.ok(!ok.warnings.some((w) => w.level === 'fail'), JSON.stringify(ok.warnings));
  assert.ok(ok.warnings.some((w) => /Boost falls/.test(w.text)), 'boost taper noticed');
  const bad = L.analysePull(pullSamples({ knockAt: 4500, lambda: 1.0, iatRise: 20 }), {});
  const knock = bad.warnings.find((w) => /knock/i.test(w.text));
  assert.ok(knock); assert.equal(knock.knock[0].rpm, 4500);
  assert.ok(bad.warnings.some((w) => /too lean/.test(w.text)));
  assert.ok(bad.warnings.some((w) => /Intake air rose (19|20) /.test(w.text)));
  assert.equal(L.analysePull([{ t: 0, '010C': 3000 }]).curve.length, 0);
  // tip-in: the first reads happen before the throttle opened (high cruise timing, stale airflow) — not knock, not a peak
  const tipIn = [{ t: 0, '010C': 1726, '0110': 100, '010E': 14 }, { t: 100, '010C': 1730, '0110': 30, '010E': 9 }, { t: 200, '010C': 1800, '0110': 32, '010E': 9 }, ...pullSamples().map((x) => ({ ...x, t: x.t + 300 }))];
  const ti = L.analysePull(tipIn, {});
  assert.ok(!ti.warnings.some((w) => /knock/i.test(w.text)), 'tip-in transient is not knock');
  assert.equal(ti.peak.nmRpm > 2000, true, 'no bogus low-rpm torque peak from a stale airflow reading');
  const lift = [...pullSamples(), { t: 6200, '010C': 1726, '0110': 100, '010E': 14, '0111': 20 }, { t: 6350, '010C': 1700, '0110': 90, '010E': 30, '0111': 15 }];
  const lf = L.analysePull(lift, {});
  assert.equal(lf.curve[0].rpm >= 2000, true, 'lift-off samples after the pull are not part of the curve');
  assert.equal(lf.peak.nmRpm > 2000, true);
});

test('API: virtual dyno per pull and overlaid curves in the comparison', async () => {
  const v = await car(A, '2.0 TFSI');
  const mk = async (samples) => (await scan(A, { vehicle_id: v, kind: 'pull', summary: pull(Math.max(...samples.map((x) => x['0110'])), 220), samples })).body;
  const b = await mk(pullSamples()); const a = await mk(pullSamples({ mafScale: 1.15 }));
  const dyno = (await ctx.call('GET', `/tuning/pull/${b.id}`, { token: A })).body;
  assert.equal(dyno.peak.kwRpm, 6000); assert.ok(dyno.curve.length > 10);
  assert.equal((await ctx.call('GET', `/tuning/pull/${b.id}`, { token: B })).status, 404);
  const c = (await ctx.call('GET', `/tuning/compare?before=${b.id}&after=${a.id}`, { token: A })).body;
  assert.ok(c.after.peak.kw > c.before.peak.kw);
  assert.equal(c.before.curve.length, c.after.curve.length);
});

test('ECU reference: create/upsert/delete, validation, tenant isolation', async () => {
  const bad = await ctx.call('POST', '/tuning/ecu', { token: A, body: { make: 'VW' } });
  assert.equal(bad.status, 400, 'ECU name required');
  const p = await ctx.call('POST', '/tuning/ecu', { token: A, body: { ecu_name: 'Bosch MED17.5.5', make: 'VW/Audi', access_method: 'bench', tool: 'KESS3', road_legal: 'track', security_note: 'OBD locked from MY2018', notes: 'Boot mode needs ECU out.' } });
  assert.equal(p.status, 201); assert.equal(p.body.ecu_key, 'bosch med17.5.5'); assert.equal(p.body.access_method, 'bench');
  // upsert: same ECU name for the same shop updates, does not duplicate
  const up = await ctx.call('POST', '/tuning/ecu', { token: A, body: { ecu_name: 'bosch  MED17.5.5', access_method: 'nonsense', road_legal: 'road', tool: 'Autotuner' } });
  assert.equal(up.body.id, p.body.id); assert.equal(up.body.access_method, 'unknown', 'invalid method falls back'); assert.equal(up.body.tool, 'Autotuner');
  const mine = await ctx.call('GET', '/tuning/ecu', { token: A });
  assert.equal(mine.body.own.length, 1); assert.deepEqual(mine.body.access, ['obd', 'bench', 'boot', 'unknown']);
  assert.equal((await ctx.call('GET', '/tuning/ecu', { token: B })).body.own.length, 0, 'not visible to another shop');
  assert.equal((await ctx.call('DELETE', `/tuning/ecu/${p.body.id}`, { token: B })).status, 404, 'other shop cannot delete it');
  assert.equal((await ctx.call('DELETE', `/tuning/ecu/${p.body.id}`, { token: A })).status, 204);
  assert.equal((await ctx.call('GET', '/tuning/ecu', { token: A })).body.own.length, 0);
});

test('ECU reference shows on the vehicle whose ECU name matches, and is opt-in shared & anonymised', async () => {
  await ctx.call('POST', '/tuning/ecu', { token: A, body: { ecu_name: 'ECM-EngineControl', access_method: 'obd', tool: 'MyGenius', road_legal: 'road' } });
  const v = await car(A, '1.8 TSI');
  await scan(A, { vehicle_id: v, ecu_info: { calids: ['8V0906259'], names: ['ECM-EngineControl'], vin: 'WVWZZZ6RZHY654321' } });
  const own = (await ctx.call('GET', `/tuning/vehicle/${v}`, { token: A })).body;
  assert.deepEqual(own.ecu.names, ['ECM-EngineControl']);
  assert.equal(own.ecu.documented, true);
  assert.equal(own.ecu.reference[0].entries[0].tool, 'MyGenius');

  // shared: B documents an ECU; C sees it only when both opt in, and without any tenant identity
  await ctx.call('POST', '/tuning/ecu', { token: B, body: { ecu_name: 'Continental SID208', access_method: 'bench', tool: 'Trasdata', road_legal: 'track', security_note: 'OBD read only' } });
  const cv = await car(C, '2.0 TDI');
  await scan(C, { vehicle_id: cv, ecu_info: { calids: ['04L906056'], names: ['Continental SID208'] } });
  await ctx.call('PUT', '/shop', { token: C, body: { share_engine_data: false } });
  await ctx.call('PUT', '/shop', { token: B, body: { share_engine_data: false } });
  const before = (await ctx.call('GET', `/tuning/vehicle/${cv}`, { token: C })).body;
  assert.equal(before.ecu.reference.length, 0, 'nothing shared until both opt in');
  await ctx.call('PUT', '/shop', { token: C, body: { share_engine_data: true } });
  assert.equal((await ctx.call('GET', `/tuning/vehicle/${cv}`, { token: C })).body.ecu.reference.length, 0, 'C alone is not enough');
  await ctx.call('PUT', '/shop', { token: B, body: { share_engine_data: true } });
  const after = (await ctx.call('GET', `/tuning/vehicle/${cv}`, { token: C })).body;
  assert.equal(after.ecu.reference.length, 1);
  assert.equal(after.ecu.reference[0].entries[0].access_method, 'bench');
  assert.equal(after.ecu.documented, false, 'C has no note of its own for this ECU');
  const lib = await ctx.call('GET', '/tuning/ecu', { token: C });
  assert.ok(lib.body.reference.some((r) => r.ecu_key === 'continental sid208'));
  const raw = JSON.stringify(after.ecu) + JSON.stringify(lib.body.reference);
  const bId = (await db.query(`SELECT id FROM tenants WHERE name = 'Tune B'`)).rows[0].id;
  assert.ok(!raw.includes(`t${bId}`) && !raw.includes('tenant_id') && !raw.includes('"id":'), 'no shop/tenant identity leaks into shared reference');
});
