// Workshop profile, audit trail, and POPIA data rights (export / erasure).
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { wrap, HttpError } = require('../lib/http');
const { sanitize } = require('../lib/validate');
const { requireAdmin, subscriptionGuard } = require('../middleware/auth');
const { encrypt } = require('../lib/secrets');

const router = express.Router();
const LOGO_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const PROFILE = 'id, name, email, phone, address, vat_number, bank_details, logo, reminders_enabled, plan, plan_status, trial_ends_at, terms_accepted_at, pf_merchant_id, (pf_merchant_key IS NOT NULL) AS pf_key_set, (pf_passphrase_enc IS NOT NULL) AS pf_passphrase_set';

router.get('/', wrap(async (req, res) => {
  const { rows } = await db.query(`SELECT ${PROFILE} FROM tenants WHERE id = $1`, [req.user.tenantId]);
  res.json(rows[0]);
}));

router.put('/', requireAdmin, subscriptionGuard, wrap(async (req, res) => {
  const { values, error } = sanitize(req.body, { name: 'text', email: 'email', phone: 'text', address: 'text', vat_number: 'text', bank_details: 'longtext' }, { partial: true });
  if (error) throw new HttpError(400, error);
  if (values.name === null) throw new HttpError(400, 'Workshop name is required');
  const b = req.body || {};
  if (b.logo !== undefined) {
    if (b.logo !== null && b.logo !== '' && (typeof b.logo !== 'string' || b.logo.length > 400_000 || !LOGO_RE.test(b.logo))) throw new HttpError(400, 'Logo must be a PNG or JPEG under about 250 KB');
    values.logo = b.logo || null;
  }
  if (b.reminders_enabled !== undefined) values.reminders_enabled = b.reminders_enabled === true;
  // The workshop's own PayFast account for customer payment links. Key and passphrase are write-only.
  const pf = (v, max) => (typeof v === 'string' && v.length <= max ? v.trim() : undefined);
  if (b.pf_merchant_id !== undefined) { const v = pf(b.pf_merchant_id, 20); if (v === undefined || (v && !/^\d+$/.test(v))) throw new HttpError(400, 'Invalid PayFast merchant ID'); values.pf_merchant_id = v || null; }
  if (b.pf_merchant_key) { const v = pf(b.pf_merchant_key, 40); if (!v) throw new HttpError(400, 'Invalid PayFast merchant key'); values.pf_merchant_key = v; }
  if (b.pf_passphrase !== undefined && b.pf_passphrase !== '') { const v = pf(b.pf_passphrase, 100); if (!v) throw new HttpError(400, 'Invalid passphrase'); values.pf_passphrase_enc = encrypt(v); }
  const keys = Object.keys(values);
  if (!keys.length) throw new HttpError(400, 'Nothing to update');
  const { rows } = await db.query(`UPDATE tenants SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING ${PROFILE}`, [req.user.tenantId, ...keys.map((k) => values[k])]);
  res.json(rows[0]);
}));

router.get('/audit', requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY id DESC LIMIT 300', [req.user.tenantId]);
  res.json(rows);
}));

// Everything the workshop has stored, as one JSON file (data portability / access request).
router.get('/export', requireAdmin, wrap(async (req, res) => {
  const t = req.user.tenantId; const out = { exported_at: new Date().toISOString() };
  out.shop = (await db.query(`SELECT ${PROFILE.replace(' logo,', '')} FROM tenants WHERE id = $1`, [t])).rows[0];
  out.users = (await db.query('SELECT id, name, email, role, created_at FROM users WHERE tenant_id = $1', [t])).rows;
  for (const tbl of ['customers', 'vehicles', 'invoices', 'inspections', 'remaps', 'jobs', 'parts', 'dtc_events', 'audit_log']) {
    out[tbl] = (await db.query(`SELECT * FROM ${tbl} WHERE tenant_id = $1`, [t])).rows;
  }
  out.scan_sessions = (await db.query('SELECT id, vehicle_id, protocol, source, started_at, ended_at, summary, readiness, freeze_frame FROM scan_sessions WHERE tenant_id = $1', [t])).rows;
  res.setHeader('Content-Disposition', 'attachment; filename="diagnosticos-export.json"');
  res.json(out);
}));

// Permanently deletes the workshop and every record it owns (right to erasure). Needs the admin's password.
router.delete('/', requireAdmin, wrap(async (req, res) => {
  const pw = req.body && req.body.password;
  const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (typeof pw !== 'string' || !(await bcrypt.compare(pw, rows[0].password_hash))) throw new HttpError(403, 'Password is incorrect');
  if (!req.body.confirm || req.body.confirm !== req.user.tenant.name) throw new HttpError(400, 'Type the workshop name to confirm');
  await db.query('DELETE FROM tenants WHERE id = $1', [req.user.tenantId]);
  res.status(204).end();
}));

module.exports = router;
