const jwt = require('jsonwebtoken');
const db = require('../db');
const { config } = require('../config');
const { wrap, HttpError } = require('../lib/http');

function signToken(user) {
  return jwt.sign({ sub: user.id, tid: user.tenant_id, role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Verifies the bearer token and loads the user + tenant fresh from the database,
// so deleted users and changed plans take effect immediately.
const authenticate = wrap(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (_) {
    throw new HttpError(401, 'Invalid or expired token');
  }
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.tenant_id, u.email_verified,
            t.name AS tenant_name, t.plan, t.plan_status, t.trial_ends_at
       FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.tenant_id = $2`,
    [payload.sub, payload.tid]
  );
  if (!rows[0]) throw new HttpError(401, 'Account no longer exists');
  const r = rows[0];
  req.user = {
    id: r.id, name: r.name, email: r.email, role: r.role, tenantId: r.tenant_id, emailVerified: !!r.email_verified,
    tenant: { name: r.tenant_name, plan: r.plan, planStatus: r.plan_status, trialEndsAt: r.trial_ends_at },
  };
  next();
});

const requireAdmin = (req, _res, next) => {
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Admin access required'));
  next();
};

function subscriptionActive(tenant) {
  if (tenant.planStatus === 'active') return true;
  if (tenant.planStatus === 'trial') return !tenant.trialEndsAt || new Date(tenant.trialEndsAt) > new Date();
  return false;
}

// Expired trials and cancelled subscriptions become read-only: reads work, writes return 402.
const subscriptionGuard = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (!subscriptionActive(req.user.tenant)) {
    return next(new HttpError(402, 'Your trial has ended or your subscription is inactive. Choose a plan under Billing to continue.', { code: 'subscription_inactive' }));
  }
  next();
};

module.exports = { signToken, authenticate, requireAdmin, subscriptionGuard, subscriptionActive };
