const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { config } = require('../config');
const { wrap, HttpError } = require('../lib/http');
const { sanitize } = require('../lib/validate');
const { signToken, authenticate } = require('../middleware/auth');
const tokens = require('../lib/tokens');
const { sendEmail } = require('../lib/mailer');

const HOUR = 3600 * 1000;
async function sendVerification(user) {
  const t = await tokens.create(user.id, 'verify', 48 * HOUR);
  await sendEmail({ to: user.email, subject: 'Verify your DiagnosticOS email', text: `Hi ${user.name},\n\nConfirm your email address:\n${config.appUrl}/#verify=${t}\n\nThe link works for 48 hours.` });
}

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function publicUser(u, tenant) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, emailVerified: !!u.email_verified,
    tenant: { name: tenant.name, plan: tenant.plan, planStatus: tenant.planStatus, trialEndsAt: tenant.trialEndsAt },
  };
}

router.post('/register', authLimiter, wrap(async (req, res) => {
  const { values, error } = sanitize(req.body, {
    shopName: 'text', name: 'text', email: 'email', plan: 'enum:starter|pro|enterprise',
  }, { required: ['shopName', 'name', 'email'] });
  if (error) throw new HttpError(400, error);
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
    throw new HttpError(400, 'Password must be 8–72 characters');
  }
  if (!req.body || req.body.acceptTerms !== true) throw new HttpError(400, 'You must accept the Terms and Privacy Policy');
  const plan = values.plan || 'starter';
  const hash = await bcrypt.hash(password, 10);

  const out = await db.transaction(async (client) => {
    const dupe = await client.query('SELECT 1 FROM users WHERE email = $1', [values.email]);
    if (dupe.rows[0]) throw new HttpError(409, 'An account with that email already exists');
    const trialEnds = new Date(Date.now() + config.trialDays * 86400000);
    const t = await client.query(
      `INSERT INTO tenants (name, plan, plan_status, trial_ends_at, email, terms_accepted_at) VALUES ($1,$2,'trial',$3,$4, now()) RETURNING *`,
      [values.shopName, plan, trialEnds, values.email]
    );
    const u = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,'admin') RETURNING *`,
      [t.rows[0].id, values.email, hash, values.name]
    );
    return { tenant: t.rows[0], user: u.rows[0] };
  });

  sendVerification(out.user).catch(() => {});
  const tenant = { name: out.tenant.name, plan: out.tenant.plan, planStatus: out.tenant.plan_status, trialEndsAt: out.tenant.trial_ends_at };
  res.status(201).json({ token: signToken(out.user), user: publicUser(out.user, tenant) });
}));

router.post('/login', authLimiter, wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const { rows } = await db.query(
    `SELECT u.*, t.name AS tenant_name, t.plan, t.plan_status, t.trial_ends_at
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.email = $1`, [email]);
  const row = rows[0];
  const ok = await bcrypt.compare(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new HttpError(401, 'Incorrect email or password');
  const tenant = { name: row.tenant_name, plan: row.plan, planStatus: row.plan_status, trialEndsAt: row.trial_ends_at };
  res.json({ token: signToken(row), user: publicUser(row, tenant) });
}));

router.post('/forgot', authLimiter, wrap(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const { rows } = await db.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
  if (rows[0]) {
    const t = await tokens.create(rows[0].id, 'reset', HOUR);
    sendEmail({ to: rows[0].email, subject: 'Reset your DiagnosticOS password', text: `Hi ${rows[0].name},\n\nReset your password here (valid for 1 hour):\n${config.appUrl}/#reset=${t}\n\nIf you didn't ask for this, ignore this email.` }).catch(() => {});
  }
  res.json({ ok: true }); // same answer whether or not the address exists
}));

router.post('/reset', authLimiter, wrap(async (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new HttpError(400, 'Password must be 8–72 characters');
  const uid = await tokens.consume(req.body.token, 'reset');
  if (!uid) throw new HttpError(400, 'This reset link is invalid or has expired');
  await db.query('UPDATE users SET password_hash = $2, email_verified = true WHERE id = $1', [uid, await bcrypt.hash(password, 10)]);
  await db.query(`UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL`, [uid]);
  res.json({ ok: true });
}));

router.post('/verify', authLimiter, wrap(async (req, res) => {
  const uid = await tokens.consume(req.body && req.body.token, 'verify');
  if (!uid) throw new HttpError(400, 'This verification link is invalid or has expired');
  await db.query('UPDATE users SET email_verified = true WHERE id = $1', [uid]);
  res.json({ ok: true });
}));

router.post('/resend-verification', authenticate, authLimiter, wrap(async (req, res) => {
  const { rows } = await db.query('SELECT id, name, email, email_verified FROM users WHERE id = $1', [req.user.id]);
  if (!rows[0].email_verified) await sendVerification(rows[0]);
  res.json({ ok: true });
}));

router.get('/me', authenticate, (req, res) => {
  res.json(publicUser({ id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, email_verified: req.user.emailVerified }, req.user.tenant));
});

module.exports = router;
