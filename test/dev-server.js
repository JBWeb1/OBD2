// In-memory server for browser smoke tests: node test/dev-server.js  (no Postgres needed)
process.env.NODE_ENV = 'development';
process.env.ALLOW_DEV_PLAN_SWITCH = 'true';
const fs = require('fs'); const path = require('path');
const { newDb } = require('pg-mem');
const db = require('../src/db');
const { createApp } = require('../src/app');
(async () => {
  const { Pool } = newDb().adapters.createPg(); const pool = new Pool(); db.setPool(pool);
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  createApp().listen(3111, () => console.log('up'));
})();
