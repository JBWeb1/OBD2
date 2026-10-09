const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { config } = require('../config');
const { wrap, HttpError } = require('../lib/http');
const { sanitize } = require('../lib/validate');
const { parseId } = require('../lib/crud');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, wrap(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, email, role, created_at FROM users WHERE tenant_id = $1 ORDER BY id', [req.user.tenantId]);
  res.json(rows);
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const { values, error } = sanitize(req.body, { name: 'text', email: 'email', role: 'enum:admin|technician' }, { required: ['name', 'email'] });
  if (error) throw new HttpError(400, error);
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new HttpError(400, 'Password must be 8–72 characters');

  const limit = config.plans[req.user.tenant.plan].users;
  const { rows: cnt } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = $1', [req.user.tenantId]);
  if (cnt[0].n >= limit) throw new HttpError(402, `Your ${config.plans[req.user.tenant.plan].name} plan allows ${limit} users. Upgrade to add more.`, { code: 'user_limit' });

  const dupe = await db.query('SELECT 1 FROM users WHERE email = $1', [values.email]);
  if (dupe.rows[0]) throw new HttpError(409, 'An account with that email already exists');

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    `INSERT INTO users (tenant_id, email, password_hash, name, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role`,
    [req.user.tenantId, values.email, hash, values.name, values.role || 'technician']);
  res.status(201).json(rows[0]);
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
  const { rowCount } = await db.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [id, req.user.tenantId]);
  if (!rowCount) throw new HttpError(404, 'Not found');
  res.status(204).end();
}));

module.exports = router;
