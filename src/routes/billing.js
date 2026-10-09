const express = require('express');
const db = require('../db');
const { config } = require('../config');
const { wrap, HttpError } = require('../lib/http');
const { requireAdmin, subscriptionActive } = require('../middleware/auth');
const { buildCheckout, verifyITN, amountString } = require('../lib/payfast');
const { decrypt } = require('../lib/secrets');
const { monthlyUsage } = require('./scans');

const router = express.Router();          // authenticated
const itn = express.Router();             // public webhook

const publicPlans = () => Object.entries(config.plans).map(([key, p]) => ({
  key, name: p.name, priceCents: p.priceCents,
  scansPerMonth: Number.isFinite(p.scansPerMonth) ? p.scansPerMonth : null,
  users: Number.isFinite(p.users) ? p.users : null,
}));

router.get('/', wrap(async (req, res) => {
  const t = req.user.tenant;
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1', [req.user.tenantId]);
  const plan = config.plans[t.plan];
  res.json({
    plan: t.plan, planStatus: t.planStatus, trialEndsAt: t.trialEndsAt, active: subscriptionActive(t),
    usage: { scans: await monthlyUsage(req.user.tenantId), scanLimit: Number.isFinite(plan.scansPerMonth) ? plan.scansPerMonth : null,
             users: rows[0].n, userLimit: Number.isFinite(plan.users) ? plan.users : null },
    plans: publicPlans(),
    paymentsEnabled: config.payfast.enabled,
    devPlanSwitch: config.allowDevPlanSwitch,
  });
}));

router.post('/checkout', requireAdmin, wrap(async (req, res) => {
  const planKey = req.body && req.body.plan;
  if (!config.plans[planKey]) throw new HttpError(400, 'Unknown plan');
  if (!config.payfast.enabled) throw new HttpError(503, 'Online payments are not configured on this server.');
  const { rows } = await db.query('SELECT id FROM tenants WHERE id = $1', [req.user.tenantId]);
  res.json(buildCheckout({ tenant: rows[0], user: req.user, planKey }));
}));

// Development only: switch plans without paying. Disabled in production.
router.post('/dev-switch', requireAdmin, wrap(async (req, res) => {
  if (!config.allowDevPlanSwitch) throw new HttpError(404, 'Not found');
  const planKey = req.body && req.body.plan;
  if (!config.plans[planKey]) throw new HttpError(400, 'Unknown plan');
  await db.query(`UPDATE tenants SET plan = $2, plan_status = 'active' WHERE id = $1`, [req.user.tenantId, planKey]);
  res.json({ ok: true });
}));

// A customer paid an invoice through its payment link: verified against the workshop's own PayFast credentials.
async function handleInvoicePayment(pairs, raw, ip) {
  if (!/^[0-9a-f]{32}$/.test(String(raw.custom_str2))) return console.warn('ITN: bad invoice token');
  const { rows } = await db.query(
    `SELECT i.id, i.total_cents, i.status, i.kind, t.pf_merchant_id, t.pf_passphrase_enc FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.pay_token = $1`, [raw.custom_str2]);
  const inv = rows[0];
  if (!inv || inv.kind !== 'invoice' || !inv.pf_merchant_id) return console.warn('ITN: unknown invoice');
  if (raw.merchant_id !== inv.pf_merchant_id) return console.warn('ITN: merchant mismatch');
  const v = await verifyITN(pairs, ip, { skipNetwork: itn.skipNetwork, passphrase: decrypt(inv.pf_passphrase_enc) });
  if (!v.ok) return console.warn('ITN rejected:', v.reason);
  if (raw.payment_status === 'COMPLETE' && raw.amount_gross === amountString(inv.total_cents) && inv.status !== 'paid') {
    await db.query(`UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [inv.id]);
  }
}

// PayFast ITN webhook: unauthenticated, trusted only after signature + source + server-to-server validation.
itn.post('/', express.urlencoded({ extended: false }), async (req, res) => {
  res.status(200).end(); // acknowledge immediately, as PayFast requires
  try {
    const pairs = Object.entries(req.body || {});
    const raw = Object.fromEntries(pairs);
    if (raw.custom_str1 === 'inv') return await handleInvoicePayment(pairs, raw, req.ip);
    const v = await verifyITN(pairs, req.ip, { skipNetwork: itn.skipNetwork });
    if (!v.ok) return console.warn('ITN rejected:', v.reason);
    const d = v.data;
    const tenantId = Number(d.custom_str1);
    const planKey = d.custom_str2;
    if (!Number.isInteger(tenantId) || !config.plans[planKey]) return console.warn('ITN: bad custom fields');
    if (d.payment_status === 'COMPLETE') {
      if (d.amount_gross !== amountString(config.plans[planKey].priceCents)) return console.warn('ITN: amount mismatch');
      await db.query(`UPDATE tenants SET plan = $2, plan_status = 'active', payfast_token = COALESCE($3, payfast_token) WHERE id = $1`,
        [tenantId, planKey, d.token || null]);
    } else if (d.payment_status === 'CANCELLED') {
      await db.query(`UPDATE tenants SET plan_status = 'cancelled' WHERE id = $1`, [tenantId]);
    }
  } catch (e) { console.error('ITN error', e.message); }
});

module.exports = { router, itn };
