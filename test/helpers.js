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

// In-memory Postgres by default. Set TEST_DATABASE_URL to run against a real Postgres instead:
// each test process gets its own throwaway schema, so test files can run in parallel.
async function makePool() {
  if (!process.env.TEST_DATABASE_URL) {
    const { Pool } = newDb().adapters.createPg();
    return new Pool();
  }
  const { Pool, types } = require('pg');
  types.setTypeParser(1082, (v) => v);
  const schema = `test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  pool.dropSchema = async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); };
  return pool;
}

async function start() {
  const pool = await makePool();
  db.setPool(pool);
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  if (process.env.TEST_DATABASE_URL) await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'upgrade.sql'), 'utf8'));
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
  return { call, register, pool, base, itnUrl: base + '/billing/itn', close: () => { server.close(); if (pool.dropSchema) pool.dropSchema().catch(() => {}); } };
}
module.exports = { start, db };
