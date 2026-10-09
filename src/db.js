const { config } = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    const { Pool, types } = require('pg');
    // Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (avoids timezone shifts).
    types.setTypeParser(1082, (v) => v);
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.isProd && !/localhost|127\.0\.0\.1|@db:/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }
  return pool;
}

// Lets tests inject an in-memory pool.
function setPool(p) { pool = p; }

const query = (text, params) => getPool().query(text, params);

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { query, transaction, getPool, setPool };
