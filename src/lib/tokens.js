const crypto = require('crypto');
const db = require('../db');

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function create(userId, kind, ttlMs) {
  const raw = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3,$4)', [userId, kind, hash(raw), new Date(Date.now() + ttlMs)]);
  return raw;
}

// Single use: returns the user id and marks the token used, or null if unknown/expired/already used.
async function consume(raw, kind) {
  if (typeof raw !== 'string' || raw.length !== 64) return null;
  const { rows } = await db.query(
    `UPDATE auth_tokens SET used_at = $3 WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3 RETURNING user_id`,
    [hash(raw), kind, new Date()]);
  return rows[0] ? rows[0].user_id : null;
}
module.exports = { create, consume };
