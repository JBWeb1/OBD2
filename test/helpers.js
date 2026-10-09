const fs = require('fs');
const path = require('path');
const { newDb } = require('pg-mem');
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.PAYFAST_MERCHANT_ID = '10000100';
process.env.PAYFAST_MERCHANT_KEY = '46f0cd694581a';
process.env.PAYFAST_PASSPHRASE = 'jt7NOE43FZPn';
const db = require('../src/db');
const { createApp } = require('../src/app');

async function start() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  db.setPool(pool);
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function call(method, url, { token, body } = {}) {
    const r = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null; try { json = await r.json(); } catch (_) { /* empty */ }
    return { status: r.status, body: json };
  }
  async function register(name, email) {
    const r = await call('POST', '/auth/register', { body: { shopName: name, name: 'Owner', email, password: 'password123', acceptTerms: true } });
    return r.body.token;
  }
  return { call, register, pool, base, itnUrl: base + '/billing/itn', close: () => server.close() };
}
module.exports = { start, db };
