// Customers, vehicles, inspections and remaps. Plain CRUD plus a few computed columns.
const express = require('express');
const db = require('../db');
const { crud, parseId, assertOwned } = require('../lib/crud');
const { wrap, HttpError } = require('../lib/http');

const byKey = (rows, key) => new Map(rows.map((r) => [r[key], r]));

// ---------- customers ----------
const customers = crud({
  table: 'customers',
  spec: { first_name: 'text', last_name: 'text', email: 'email', phone: 'text', notes: 'longtext', status: 'enum:new|regular|vip' },
  required: ['first_name'],
  order: 'first_name, last_name',
  decorateList: async (rows, req) => {
    const t = req.user.tenantId;
    const [veh, inv] = await Promise.all([
      db.query('SELECT customer_id, COUNT(*)::int AS n FROM vehicles WHERE tenant_id = $1 AND customer_id IS NOT NULL GROUP BY customer_id', [t]),
      db.query(`SELECT customer_id, status, due_on, total_cents, issued_on FROM invoices WHERE tenant_id = $1 AND kind = 'invoice' AND customer_id IS NOT NULL`, [t]),
    ]);
    const vmap = byKey(veh.rows, 'customer_id');
    const agg = new Map();
    for (const i of inv.rows) {
      const a = agg.get(i.customer_id) || { spend: 0, balance: 0, last: null };
      if (i.status === 'paid') a.spend += i.total_cents;
      if (i.status === 'outstanding') a.balance += i.total_cents;
      if (!a.last || i.issued_on > a.last) a.last = i.issued_on;
      agg.set(i.customer_id, a);
    }
    return rows.map((c) => {
      const a = agg.get(c.id) || { spend: 0, balance: 0, last: null };
      return { ...c, vehicle_count: vmap.get(c.id)?.n || 0, spend_cents: a.spend, balance_cents: a.balance, last_visit: a.last };
    });
  },
});

// ---------- vehicles ----------
const vehicles = crud({
  table: 'vehicles',
  spec: {
    customer_id: 'int', plate: 'text', vin: 'text', make: 'text', model: 'text',
    year: 'int', engine: 'text', colour: 'text', mileage_km: 'int', next_service_on: 'date', next_service_km: 'int',
  },
  required: ['make', 'model'],
  order: 'created_at DESC',
  decorateList: async (rows, req) => {
    const t = req.user.tenantId;
    const [cust, dtc, scan] = await Promise.all([
      db.query('SELECT id, first_name, last_name FROM customers WHERE tenant_id = $1', [t]),
      db.query(`SELECT vehicle_id, COUNT(*)::int AS n FROM dtc_events WHERE tenant_id = $1 AND status IN ('active','pending') GROUP BY vehicle_id`, [t]),
      db.query('SELECT vehicle_id, MAX(started_at) AS last FROM scan_sessions WHERE tenant_id = $1 GROUP BY vehicle_id', [t]),
    ]);
    const cmap = byKey(cust.rows, 'id'), dmap = byKey(dtc.rows, 'vehicle_id'), smap = byKey(scan.rows, 'vehicle_id');
    return rows.map((v) => {
      const c = cmap.get(v.customer_id);
      return {
        ...v,
        owner: c ? `${c.first_name} ${c.last_name}`.trim() : null,
        open_dtcs: dmap.get(v.id)?.n || 0,
        last_scan: smap.get(v.id)?.last || null,
      };
    });
  },
});

// ---------- inspections ----------
const inspections = crud({
  table: 'inspections',
  spec: { vehicle_id: 'int', customer_id: 'int', type: 'enum:pre-purchase|service|roadworthy|tuning', items: 'json', notes: 'longtext' },
  required: ['vehicle_id'],
  decorateList: async (rows, req) => {
    const v = await db.query('SELECT id, make, model, plate FROM vehicles WHERE tenant_id = $1', [req.user.tenantId]);
    const vmap = byKey(v.rows, 'id');
    return rows.map((r) => ({ ...r, vehicle: vmap.get(r.vehicle_id) || null }));
  },
});
inspections.post('/:id/sign-off', wrap(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE inspections SET status = 'signed_off', signed_off_by = $3, signed_off_at = now()
      WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [parseId(req.params.id), req.user.tenantId, req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Not found');
  res.json(rows[0]);
}));

// ---------- remaps ----------
const remaps = crud({
  table: 'remaps',
  spec: { vehicle_id: 'int', ecu: 'text', stage: 'text', power_before_kw: 'int', power_after_kw: 'int', tuner: 'text', notes: 'longtext', done_on: 'date' },
  required: ['vehicle_id'],
  order: 'done_on DESC, id DESC',
  decorateList: async (rows, req) => {
    const v = await db.query('SELECT id, make, model, year FROM vehicles WHERE tenant_id = $1', [req.user.tenantId]);
    const vmap = byKey(v.rows, 'id');
    return rows.map((r) => ({ ...r, vehicle: vmap.get(r.vehicle_id) || null }));
  },
});

// ---------- jobs / bookings ----------
const jobs = crud({
  table: 'jobs',
  spec: { vehicle_id: 'int', customer_id: 'int', assigned_to: 'int', title: 'text', status: 'enum:booked|in_progress|ready|done', scheduled_for: 'datetime', notes: 'longtext' },
  required: ['title'],
  order: 'scheduled_for ASC, id DESC',
  decorateList: async (rows, req) => {
    const t = req.user.tenantId;
    const [v, c, u] = await Promise.all([
      db.query('SELECT id, make, model, year, plate FROM vehicles WHERE tenant_id = $1', [t]),
      db.query('SELECT id, first_name, last_name, phone FROM customers WHERE tenant_id = $1', [t]),
      db.query('SELECT id, name FROM users WHERE tenant_id = $1', [t]),
    ]);
    const vm = byKey(v.rows, 'id'), cm = byKey(c.rows, 'id'), um = byKey(u.rows, 'id');
    return rows.map((j) => ({ ...j, vehicle: vm.get(j.vehicle_id) || null, customer: cm.get(j.customer_id) || null, assignee: um.get(j.assigned_to)?.name || null }));
  },
});

// ---------- parts & stock (the workshop's own inventory) ----------
const nonNeg = (v) => { for (const k of ['cost_cents', 'price_cents', 'qty', 'min_qty']) if (v[k] != null && v[k] < 0) throw new HttpError(400, `"${k}" cannot be negative`); };
const parts = crud({
  table: 'parts',
  spec: { sku: 'text', name: 'text', supplier: 'text', cost_cents: 'int', price_cents: 'int', qty: 'int', min_qty: 'int' },
  required: ['name'],
  order: 'name',
  check: nonNeg,
  decorateList: async (rows) => rows.map((p) => ({ ...p, low_stock: p.min_qty > 0 && p.qty <= p.min_qty })),
});
parts.post('/import', wrap(async (req, res) => {
  const rowsIn = req.body && req.body.rows;
  if (!Array.isArray(rowsIn) || !rowsIn.length || rowsIn.length > 1000) throw new HttpError(400, 'Send 1–1000 rows');
  const { sanitize } = require('../lib/validate');
  const clean = rowsIn.map((r, i) => {
    const { values, error } = sanitize(r, { sku: 'text', name: 'text', supplier: 'text', cost_cents: 'int', price_cents: 'int', qty: 'int', min_qty: 'int' }, { required: ['name'] });
    if (error) throw new HttpError(400, `Row ${i + 1}: ${error}`);
    nonNeg(values); return values;
  });
  await db.transaction(async (c) => {
    for (const v of clean) await c.query('INSERT INTO parts (tenant_id, sku, name, supplier, cost_cents, price_cents, qty, min_qty) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.user.tenantId, v.sku || null, v.name, v.supplier || null, v.cost_cents || 0, v.price_cents || 0, v.qty || 0, v.min_qty || 0]);
  });
  res.status(201).json({ imported: clean.length });
}));
parts.post('/:id/adjust', wrap(async (req, res) => {
  const delta = Number(req.body && req.body.delta);
  if (!Number.isInteger(delta) || Math.abs(delta) > 100000) throw new HttpError(400, 'Invalid amount');
  const { rows } = await db.query('UPDATE parts SET qty = qty + $3::int WHERE id = $1 AND tenant_id = $2 AND qty + $3::int >= 0 RETURNING *', [parseId(req.params.id), req.user.tenantId, delta]);
  if (!rows[0]) throw new HttpError(400, 'Not found, or that would take stock below zero');
  res.json(rows[0]);
}));

// ---------- inspection photos ----------
const MAX_PHOTOS = 12;
inspections.get('/:id/photos', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id, item, mime, created_at FROM inspection_photos WHERE inspection_id = $1 AND tenant_id = $2 ORDER BY id', [parseId(req.params.id), req.user.tenantId]);
  res.json(rows);
}));
inspections.post('/:id/photos', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  await assertOwned(req.user.tenantId, 'inspections', id);
  const b = req.body || {};
  if (!['image/jpeg', 'image/png'].includes(b.mime)) throw new HttpError(400, 'Photo must be JPEG or PNG');
  if (typeof b.data !== 'string' || b.data.length > 1_200_000 || !/^[A-Za-z0-9+/=]+$/.test(b.data)) throw new HttpError(400, 'Photo is too large (max about 800 KB) or not valid');
  const n = await db.query('SELECT COUNT(*)::int AS n FROM inspection_photos WHERE inspection_id = $1', [id]);
  if (n.rows[0].n >= MAX_PHOTOS) throw new HttpError(400, `Max ${MAX_PHOTOS} photos per inspection`);
  const item = typeof b.item === 'string' ? b.item.slice(0, 200) : null;
  const { rows } = await db.query('INSERT INTO inspection_photos (tenant_id, inspection_id, item, mime, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, item, mime', [req.user.tenantId, id, item, b.mime, b.data]);
  res.status(201).json(rows[0]);
}));
inspections.get('/:id/photos/:pid/image', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT mime, data FROM inspection_photos WHERE id = $1 AND inspection_id = $2 AND tenant_id = $3', [parseId(req.params.pid), parseId(req.params.id), req.user.tenantId]);
  if (!rows[0]) throw new HttpError(404, 'Not found');
  res.setHeader('Content-Type', rows[0].mime); res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(rows[0].data, 'base64'));
}));
inspections.delete('/:id/photos/:pid', wrap(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM inspection_photos WHERE id = $1 AND inspection_id = $2 AND tenant_id = $3', [parseId(req.params.pid), parseId(req.params.id), req.user.tenantId]);
  if (!rowCount) throw new HttpError(404, 'Not found');
  res.status(204).end();
}));

// ---------- vehicle modification log ----------
const MOD_CATEGORIES = ['engine', 'intake', 'exhaust', 'turbo', 'fuel', 'emissions', 'suspension', 'transmission', 'software', 'other'];
const vehicleMods = crud({
  table: 'vehicle_mods',
  spec: { vehicle_id: 'int', category: 'enum:engine|intake|exhaust|turbo|fuel|emissions|suspension|transmission|software|other', title: 'text', road_legal: 'enum:road|track|check', done_on: 'date', notes: 'longtext' },
  required: ['vehicle_id', 'title'],
  order: 'done_on DESC, id DESC',
  decorateList: async (rows, req) => {
    const v = await db.query('SELECT id, make, model, year, plate FROM vehicles WHERE tenant_id = $1', [req.user.tenantId]);
    const vmap = byKey(v.rows, 'id');
    return rows.map((r) => ({ ...r, vehicle: vmap.get(r.vehicle_id) || null }));
  },
});

module.exports = { customers, vehicles, inspections, remaps, jobs, parts, vehicleMods, MOD_CATEGORIES, assertOwned };
