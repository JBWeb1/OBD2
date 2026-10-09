const express = require('express');
const db = require('../db');
const { config } = require('../config');
const { wrap, HttpError } = require('../lib/http');
const { sanitize } = require('../lib/validate');
const { parseId, assertOwned } = require('../lib/crud');
const { CODE_RE, lookup } = require('../lib/dtc');

const scans = express.Router();
const dtc = express.Router();

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

// Plan limits count live scans only (real adapter, with recorded readings). Reading or saving fault codes,
// readiness or freeze frame is always free, so a shop at its limit can still diagnose a car.
async function monthlyUsage(tenantId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM scan_sessions WHERE tenant_id = $1 AND source = 'adapter' AND summary IS NOT NULL AND started_at >= $2`,
    [tenantId, monthStart()]);
  return rows[0].n;
}

function parseCodes(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 100) throw new HttpError(400, 'Invalid "dtcs"');
  return list.map((d) => {
    const code = String(d && d.code || '').toUpperCase();
    const status = d && d.status === 'pending' ? 'pending' : 'active';
    if (!CODE_RE.test(code)) throw new HttpError(400, `Invalid trouble code "${code}"`);
    return { code, status };
  });
}

// ECU identity from the browser: keep only well-formed, short values (they are shown to other users and pooled).
function cleanEcuInfo(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw new HttpError(400, 'Invalid "ecu_info"');
  const list = (a, re, max = 10) => (Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && re.test(x)).slice(0, max);
  const out = {
    calids: list(raw.calids, /^[\x20-\x7E]{1,16}$/), cvns: list(raw.cvns, /^[0-9A-F]{8}$/), names: list(raw.names, /^[\x20-\x7E]{1,40}$/, 5),
    vin: typeof raw.vin === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/.test(raw.vin) ? raw.vin : null,
  };
  return out.calids.length || out.cvns.length || out.names.length || out.vin ? out : null;
}

scans.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, vehicle_id, user_id, protocol, source, kind, started_at, ended_at, summary, readiness
       FROM scan_sessions WHERE tenant_id = $1 ORDER BY started_at DESC LIMIT 200`, [req.user.tenantId]);
  res.json(rows);
}));

scans.get('/usage', wrap(async (req, res) => {
  const plan = config.plans[req.user.tenant.plan];
  res.json({ used: await monthlyUsage(req.user.tenantId), limit: Number.isFinite(plan.scansPerMonth) ? plan.scansPerMonth : null });
}));

scans.get('/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM scan_sessions WHERE id = $1 AND tenant_id = $2', [parseId(req.params.id), req.user.tenantId]);
  if (!rows[0]) throw new HttpError(404, 'Not found');
  res.json(rows[0]);
}));

// Saves a finished scan from the browser. `source: "adapter"` = real ELM327 readings and counts against the plan.
scans.post('/', wrap(async (req, res) => {
  const { values, error } = sanitize(req.body, {
    vehicle_id: 'int', protocol: 'text', source: 'enum:adapter|demo', summary: 'json', samples: 'json', readiness: 'json', freeze_frame: 'json', monitor_tests: 'json', kind: 'enum:live|pull',
  });
  if (error) throw new HttpError(400, error);
  const source = values.source || 'adapter';
  const codes = parseCodes(req.body && req.body.dtcs);
  const ecuInfo = cleanEcuInfo(req.body && req.body.ecu_info);
  const t = req.user.tenantId;
  if (values.vehicle_id) await assertOwned(t, 'vehicles', values.vehicle_id);

  if (source === 'adapter' && values.summary) {
    const plan = config.plans[req.user.tenant.plan];
    const used = await monthlyUsage(t);
    if (used >= plan.scansPerMonth) {
      throw new HttpError(402, `Your ${plan.name} plan includes ${plan.scansPerMonth} scans a month and you have used them all. Upgrade to keep scanning.`, { code: 'scan_limit' });
    }
  }

  const out = await db.transaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO scan_sessions (tenant_id, vehicle_id, user_id, protocol, source, ended_at, summary, samples, readiness, freeze_frame, monitor_tests, kind, ecu_info)
       VALUES ($1,$2,$3,$4,$5, now(), $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [t, values.vehicle_id || null, req.user.id, values.protocol || null, source, values.summary || null, values.samples || null, values.readiness || null, values.freeze_frame || null, values.monitor_tests || null,
       values.kind || (values.summary ? 'live' : null), ecuInfo ? JSON.stringify(ecuInfo) : null]);
    const scan = rows[0];
    if (values.vehicle_id && source === 'adapter') {
      for (const d of codes) {
        const ex = await c.query(`SELECT 1 FROM dtc_events WHERE tenant_id=$1 AND vehicle_id=$2 AND code=$3 AND status IN ('active','pending')`, [t, values.vehicle_id, d.code]);
        if (!ex.rows[0]) {
          await c.query(`INSERT INTO dtc_events (tenant_id, vehicle_id, scan_id, code, status) VALUES ($1,$2,$3,$4,$5)`, [t, values.vehicle_id, scan.id, d.code, d.status]);
        }
      }
    }
    return scan;
  });
  res.status(201).json(out);
}));

// ---------- DTC history ----------
dtc.get('/', wrap(async (req, res) => {
  const vid = req.query.vehicle_id ? parseId(req.query.vehicle_id) : null;
  const { rows } = await db.query(
    `SELECT * FROM dtc_events WHERE tenant_id = $1 ${vid ? 'AND vehicle_id = $2' : ''} ORDER BY created_at DESC LIMIT 500`,
    vid ? [req.user.tenantId, vid] : [req.user.tenantId]);
  res.json(rows.map((r) => ({ ...r, info: lookup(r.code) })));
}));

// Records that codes were cleared on the vehicle (the browser sends Mode 04 itself).
dtc.post('/clear', wrap(async (req, res) => {
  const vid = parseId(req.body && req.body.vehicle_id);
  await assertOwned(req.user.tenantId, 'vehicles', vid);
  const { rowCount } = await db.query(
    `UPDATE dtc_events SET status = 'cleared', cleared_at = now() WHERE tenant_id = $1 AND vehicle_id = $2 AND status IN ('active','pending')`,
    [req.user.tenantId, vid]);
  res.json({ cleared: rowCount });
}));

module.exports = { scans, dtc, monthlyUsage };
