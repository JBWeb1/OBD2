const express = require('express');
const db = require('../db');
const { wrap, HttpError } = require('../lib/http');
const { sanitize } = require('../lib/validate');
const { parseId, checkRefs } = require('../lib/crud');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { config } = require('../config');
const { invoicePdf } = require('../lib/pdf');
const { sendEmail } = require('../lib/mailer');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const today = () => new Date().toISOString().slice(0, 10);

function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new HttpError(400, 'Add at least one line item');
  return raw.map((i) => {
    const description = typeof i?.description === 'string' ? i.description.trim().slice(0, 300) : '';
    const qty = Number(i?.qty ?? 1);
    const unit = Number(i?.unit_cents);
    if (!description) throw new HttpError(400, 'Every line needs a description');
    if (!Number.isInteger(qty) || qty < 1 || qty > 10000) throw new HttpError(400, 'Invalid quantity');
    if (!Number.isInteger(unit) || unit < 0 || unit > 100_000_000) throw new HttpError(400, 'Invalid price');
    const pid = i && i.part_id != null ? Number(i.part_id) : null;
    if (pid !== null && (!Number.isInteger(pid) || pid < 1)) throw new HttpError(400, 'Invalid part');
    return pid ? { description, qty, unit_cents: unit, part_id: pid } : { description, qty, unit_cents: unit };
  });
}
const totalOf = (items) => items.reduce((s, i) => s + i.qty * i.unit_cents, 0);
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const withOverdue = (r) => {
  const row = { ...r, due_on: ymd(r.due_on), issued_on: ymd(r.issued_on) };
  return row.kind === 'invoice' && row.status === 'outstanding' && row.due_on && row.due_on < today() ? { ...row, status: 'overdue' } : row;
};

const SPEC = { customer_id: 'int', vehicle_id: 'int', kind: 'enum:invoice|quote', due_on: 'date' };
const STATUSES = ['outstanding', 'paid', 'draft', 'accepted', 'cancelled'];

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY issued_on DESC, id DESC LIMIT 500', [req.user.tenantId]);
  res.json(rows.map(withOverdue));
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2', [parseId(req.params.id), req.user.tenantId]);
  if (!rows[0]) throw new HttpError(404, 'Not found');
  res.json(withOverdue(rows[0]));
}));

async function takeStock(client, tenantId, items) {
  for (const i of items) {
    if (!i.part_id) continue;
    const r = await client.query('UPDATE parts SET qty = qty - $2::int WHERE id = $1 AND tenant_id = $3 AND qty >= $2::int RETURNING id', [i.part_id, i.qty, tenantId]);
    if (!r.rows[0]) throw new HttpError(400, `Not enough stock (or unknown part) for "${i.description}"`);
  }
}
async function returnStock(client, tenantId, items) {
  for (const i of items || []) if (i.part_id) await client.query('UPDATE parts SET qty = qty + $2::int WHERE id = $1 AND tenant_id = $3', [i.part_id, i.qty, tenantId]);
}

async function create(client, tenantId, { values, items, status }) {
  const t = await client.query('UPDATE tenants SET next_invoice_no = next_invoice_no + 1 WHERE id = $1 RETURNING next_invoice_no', [tenantId]);
  const number = t.rows[0].next_invoice_no - 1;
  const kind = values.kind || 'invoice';
  const { rows } = await client.query(
    `INSERT INTO invoices (tenant_id, number, kind, customer_id, vehicle_id, status, items, total_cents, due_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenantId, number, kind, values.customer_id || null, values.vehicle_id || null,
     status || (kind === 'quote' ? 'draft' : 'outstanding'), JSON.stringify(items), totalOf(items), values.due_on || null]);
  if (kind === 'invoice') await takeStock(client, tenantId, items);
  return rows[0];
}

router.post('/', wrap(async (req, res) => {
  const { values, error } = sanitize(req.body, SPEC);
  if (error) throw new HttpError(400, error);
  const items = parseItems(req.body && req.body.items);
  await checkRefs(req.user.tenantId, values);
  const row = await db.transaction((c) => create(c, req.user.tenantId, { values, items }));
  res.status(201).json(row);
}));

router.patch('/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const { values, error } = sanitize(req.body, { due_on: 'date', status: 'text' }, { partial: true });
  if (error) throw new HttpError(400, error);
  if (values.status !== undefined && !STATUSES.includes(values.status)) throw new HttpError(400, 'Invalid status');
  const items = req.body && req.body.items !== undefined ? parseItems(req.body.items) : undefined;
  const row = await db.transaction(async (c) => {
    const cur = (await c.query('SELECT items, kind, status FROM invoices WHERE id = $1 AND tenant_id = $2', [id, req.user.tenantId])).rows[0];
    if (!cur) throw new HttpError(404, 'Not found');
    const stocked = cur.kind === 'invoice' && (cur.items || []).some((x) => x.part_id);
    const sets = []; const params = [id, req.user.tenantId, cur.status];
    if (values.status !== undefined && values.status !== cur.status) {
      params.push(values.status); sets.push(`status = $${params.length}`);
      sets.push(values.status === 'paid' ? 'paid_at = now()' : 'paid_at = NULL');
      // Cancelling an invoice puts its parts back on the shelf; un-cancelling takes them again.
      if (stocked && values.status === 'cancelled') await returnStock(c, req.user.tenantId, cur.items);
      if (stocked && cur.status === 'cancelled') await takeStock(c, req.user.tenantId, cur.items);
    }
    if (values.due_on !== undefined) { params.push(values.due_on); sets.push(`due_on = $${params.length}`); }
    if (items) {
      if (cur.kind === 'invoice' && (items.some((x) => x.part_id) || stocked)) throw new HttpError(400, 'Invoices with stocked parts cannot be edited. Delete and recreate it so stock stays correct.');
      params.push(JSON.stringify(items)); sets.push(`items = $${params.length}`);
      params.push(totalOf(items)); sets.push(`total_cents = $${params.length}`);
    }
    if (!sets.length) {
      if (values.status !== undefined) return (await c.query('SELECT * FROM invoices WHERE id = $1', [id])).rows[0]; // status unchanged
      throw new HttpError(400, 'Nothing to update');
    }
    // Only applies if nobody changed the status in the meantime, so stock is never moved twice.
    const { rows } = await c.query(`UPDATE invoices SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 AND status = $3 RETURNING *`, params);
    if (!rows[0]) throw new HttpError(409, 'This invoice was changed by someone else. Reload and try again.');
    return rows[0];
  });
  res.json(withOverdue(row));
}));

router.post('/:id/convert', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const out = await db.transaction(async (c) => {
    // Claim the quote first so a double click (or two users) can't turn one quote into two invoices.
    const q = await c.query(
      `UPDATE invoices SET status = 'accepted' WHERE id = $1 AND tenant_id = $2 AND kind = 'quote' AND status <> 'accepted' RETURNING *`, [id, req.user.tenantId]);
    if (!q.rows[0]) {
      const ex = await c.query(`SELECT 1 FROM invoices WHERE id = $1 AND tenant_id = $2 AND kind = 'quote'`, [id, req.user.tenantId]);
      throw ex.rows[0] ? new HttpError(409, 'This quote has already been converted to an invoice') : new HttpError(404, 'Quote not found');
    }
    const src = q.rows[0];
    const inv = await create(c, req.user.tenantId, {
      values: { kind: 'invoice', customer_id: src.customer_id, vehicle_id: src.vehicle_id, due_on: null },
      items: src.items,
    });
    return inv;
  });
  res.status(201).json(out);
}));

async function loadFull(req) {
  const t = req.user.tenantId;
  const inv = (await db.query('SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2', [parseId(req.params.id), t])).rows[0];
  if (!inv) throw new HttpError(404, 'Not found');
  const [shop, customer, vehicle] = await Promise.all([
    db.query('SELECT name, email, phone, address, vat_number, bank_details, logo FROM tenants WHERE id = $1', [t]).then((r) => r.rows[0]),
    inv.customer_id ? db.query('SELECT * FROM customers WHERE id = $1 AND tenant_id = $2', [inv.customer_id, t]).then((r) => r.rows[0]) : null,
    inv.vehicle_id ? db.query('SELECT * FROM vehicles WHERE id = $1 AND tenant_id = $2', [inv.vehicle_id, t]).then((r) => r.rows[0]) : null,
  ]);
  return { invoice: withOverdue(inv), shop, customer, vehicle };
}
const payUrl = (inv) => (inv.pay_token ? `${config.appUrl}/pay.html#${inv.pay_token}` : null);
const label = (inv) => `${inv.kind === 'quote' ? 'Quote' : 'Invoice'} ${String(inv.number).padStart(4, '0')}`;

router.get('/:id/pdf', wrap(async (req, res) => {
  const d = await loadFull(req);
  const pdf = await invoicePdf({ ...d, payUrl: payUrl(d.invoice) });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${label(d.invoice).replace(' ', '-')}.pdf"`);
  res.send(pdf);
}));

// Emails the PDF to the customer's address on file only (not to arbitrary addresses), to prevent misuse as a mail relay.
router.post('/:id/email', rateLimit({ windowMs: 3600_000, limit: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `u${req.user.id}`, validate: false }), wrap(async (req, res) => {
  const d = await loadFull(req);
  if (!d.customer || !d.customer.email) throw new HttpError(400, 'This customer has no email address on file');
  const pdf = await invoicePdf({ ...d, payUrl: payUrl(d.invoice) });
  const link = d.invoice.kind === 'invoice' && d.invoice.status !== 'paid' ? payUrl(d.invoice) : null;
  await sendEmail({
    to: d.customer.email, subject: `${label(d.invoice)} from ${d.shop.name}`,
    text: `Hi ${d.customer.first_name},\n\nPlease find ${label(d.invoice).toLowerCase()} attached.${link ? `\n\nPay online: ${link}` : ''}\n\n${d.shop.name}${d.shop.phone ? '\n' + d.shop.phone : ''}`,
    attachments: [{ filename: `${label(d.invoice).replace(' ', '-')}.pdf`, content: pdf }],
  });
  res.json({ ok: true, to: d.customer.email });
}));

router.post('/:id/pay-link', wrap(async (req, res) => {
  const t = req.user.tenantId; const id = parseId(req.params.id);
  const shop = (await db.query('SELECT pf_merchant_id, pf_merchant_key FROM tenants WHERE id = $1', [t])).rows[0];
  if (!shop.pf_merchant_id || !shop.pf_merchant_key) throw new HttpError(400, 'Add your own PayFast merchant details under Settings first, so customer payments go to your account.');
  const { rows } = await db.query(
    `UPDATE invoices SET pay_token = COALESCE(pay_token, $3) WHERE id = $1 AND tenant_id = $2 AND kind = 'invoice' RETURNING *`, [id, t, crypto.randomBytes(16).toString('hex')]);
  if (!rows[0]) throw new HttpError(404, 'Invoice not found');
  res.json({ url: payUrl(rows[0]) });
}));

router.delete('/:id', wrap(async (req, res) => {
  await db.transaction(async (c) => {
    const r = await c.query('DELETE FROM invoices WHERE id = $1 AND tenant_id = $2 RETURNING kind, status, items', [parseId(req.params.id), req.user.tenantId]);
    if (!r.rows[0]) throw new HttpError(404, 'Not found');
    // A cancelled invoice already gave its parts back.
    if (r.rows[0].kind === 'invoice' && r.rows[0].status !== 'cancelled') await returnStock(c, req.user.tenantId, r.rows[0].items);
  });
  res.status(204).end();
}));

module.exports = router;
