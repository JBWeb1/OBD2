const express = require('express');
const db = require('../db');
const { wrap, HttpError } = require('../lib/http');
const { parseId } = require('../lib/crud');
const { lookup } = require('../lib/dtc');
const { monthlyUsage } = require('./scans');

const router = express.Router();
const today = () => new Date().toISOString().slice(0, 10);

router.get('/summary', wrap(async (req, res) => {
  const t = req.user.tenantId;
  const monthStart = today().slice(0, 8) + '01';
  const one = async (sql, p = [t]) => (await db.query(sql, p)).rows[0];
  const [c, v, d, rev, out, od] = await Promise.all([
    one('SELECT COUNT(*)::int AS n FROM customers WHERE tenant_id = $1'),
    one('SELECT COUNT(*)::int AS n FROM vehicles WHERE tenant_id = $1'),
    one(`SELECT COUNT(*)::int AS n FROM dtc_events WHERE tenant_id = $1 AND status IN ('active','pending')`),
    one(`SELECT COALESCE(SUM(total_cents),0)::int AS n FROM invoices WHERE tenant_id = $1 AND kind='invoice' AND status='paid' AND issued_on >= $2`, [t, monthStart]),
    one(`SELECT COALESCE(SUM(total_cents),0)::int AS n FROM invoices WHERE tenant_id = $1 AND kind='invoice' AND status='outstanding'`),
    one(`SELECT COUNT(*)::int AS n FROM invoices WHERE tenant_id = $1 AND kind='invoice' AND status='outstanding' AND due_on < $2`, [t, today()]),
  ]);
  res.json({
    customers: c.n, vehicles: v.n, openDtcs: d.n, revenueThisMonthCents: rev.n,
    outstandingCents: out.n, overdueInvoices: od.n, scansThisMonth: await monthlyUsage(t),
  });
}));

async function vehicleReport(req) {
  const t = req.user.tenantId; const id = parseId(req.params.id);
  const veh = (await db.query('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2', [id, t])).rows[0];
  if (!veh) throw new HttpError(404, 'Not found');
  const q = (sql) => db.query(sql, [t, id]).then((r) => r.rows);
  const [customer, scans, dtcs, invoices, inspections, remaps] = await Promise.all([
    veh.customer_id ? db.query('SELECT * FROM customers WHERE id = $1 AND tenant_id = $2', [veh.customer_id, t]).then((r) => r.rows[0] || null) : null,
    q('SELECT id, protocol, source, started_at, summary FROM scan_sessions WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY started_at DESC LIMIT 50'),
    q('SELECT * FROM dtc_events WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY created_at DESC'),
    q('SELECT * FROM invoices WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY issued_on DESC'),
    q('SELECT * FROM inspections WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY created_at DESC'),
    q('SELECT * FROM remaps WHERE tenant_id = $1 AND vehicle_id = $2 ORDER BY done_on DESC'),
  ]);
  return { vehicle: veh, customer, scans, dtcs: dtcs.map((r) => ({ ...r, info: lookup(r.code) })), invoices, inspections, remaps };
}

// Full service history for one vehicle: the data behind the customer report.
router.get('/vehicle/:id', wrap(async (req, res) => res.json(await vehicleReport(req))));
router.get('/vehicle/:id/pdf', wrap(async (req, res) => {
  const report = await vehicleReport(req);
  const shop = (await db.query('SELECT name, email, phone, address, vat_number, logo FROM tenants WHERE id = $1', [req.user.tenantId])).rows[0];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="vehicle-report.pdf"');
  res.send(await require('../lib/pdf').vehicleReportPdf({ shop, report }));
}));

module.exports = router;
