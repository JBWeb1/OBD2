// Unauthenticated endpoints for a customer opening an invoice payment link. Knowing the 128-bit token is the credential.
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { wrap, HttpError } = require('../lib/http');
const { buildInvoiceCheckout } = require('../lib/payfast');
const { decrypt } = require('../lib/secrets');

const router = express.Router();
router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

async function load(token) {
  if (!/^[0-9a-f]{32}$/.test(String(token))) throw new HttpError(404, 'Link not found');
  const { rows } = await db.query(
    `SELECT i.*, t.name AS shop_name, t.pf_merchant_id, t.pf_merchant_key, t.pf_passphrase_enc, t.phone AS shop_phone
       FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.pay_token = $1 AND i.kind = 'invoice'`, [token]);
  if (!rows[0]) throw new HttpError(404, 'Link not found');
  return rows[0];
}

router.get('/invoice/:token', wrap(async (req, res) => {
  const i = await load(req.params.token);
  res.json({ shop: i.shop_name, phone: i.shop_phone, number: i.number, status: i.status, total_cents: i.total_cents, items: i.items.map((x) => ({ description: x.description, qty: x.qty, unit_cents: x.unit_cents })), issued_on: i.issued_on, due_on: i.due_on, canPay: Boolean(i.pf_merchant_id && i.pf_merchant_key) && i.status === 'outstanding' });
}));

router.post('/invoice/:token/checkout', wrap(async (req, res) => {
  const i = await load(req.params.token);
  if (i.status === 'paid') throw new HttpError(400, 'This invoice is already paid');
  if (i.status !== 'outstanding') throw new HttpError(400, 'This invoice is no longer payable. Contact the workshop.');
  if (!i.pf_merchant_id || !i.pf_merchant_key) throw new HttpError(400, 'Online payment is not available for this invoice');
  const cust = i.customer_id ? (await db.query('SELECT first_name, last_name, email FROM customers WHERE id = $1', [i.customer_id])).rows[0] : null;
  res.json(buildInvoiceCheckout({ creds: { merchantId: i.pf_merchant_id, merchantKey: i.pf_merchant_key, passphrase: decrypt(i.pf_passphrase_enc) }, invoice: i, customer: cust, shopName: i.shop_name }));
}));

router.use((_req, res) => res.status(404).json({ error: 'Link not found' }));

module.exports = router;
