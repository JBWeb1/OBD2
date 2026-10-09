// Tenant-scoped CRUD router factory. Table/column names come from code (never from requests);
// every statement is filtered by tenant_id and every foreign key is verified to belong to the same tenant.
const express = require('express');
const db = require('../db');
const { wrap, HttpError } = require('./http');
const { sanitize } = require('./validate');

const REF_TABLES = { customer_id: 'customers', vehicle_id: 'vehicles', assigned_to: 'users' };

function parseId(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id');
  return n;
}

async function assertOwned(tenantId, table, id, client = db) {
  const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (!rows[0]) throw new HttpError(400, `Unknown ${table.replace(/s$/, '')}`);
}

async function checkRefs(tenantId, values) {
  for (const [col, table] of Object.entries(REF_TABLES)) {
    if (values[col] !== undefined && values[col] !== null) await assertOwned(tenantId, table, values[col]);
  }
}

function crud({ table, spec, required = [], order = 'id DESC', decorateList, beforeCreate, check }) {
  const router = express.Router();
  const cols = Object.keys(spec);

  router.get('/', wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY ${order} LIMIT 500`, [req.user.tenantId]);
    res.json(decorateList ? await decorateList(rows, req) : rows);
  }));

  router.get('/:id', wrap(async (req, res) => {
    const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND tenant_id = $2`, [parseId(req.params.id), req.user.tenantId]);
    if (!rows[0]) throw new HttpError(404, 'Not found');
    res.json(rows[0]);
  }));

  router.post('/', wrap(async (req, res) => {
    const { values, error } = sanitize(req.body, spec, { required });
    if (error) throw new HttpError(400, error);
    await checkRefs(req.user.tenantId, values);
    if (check) check(values);
    if (beforeCreate) await beforeCreate(values, req);
    const keys = Object.keys(values);
    const sql = `INSERT INTO ${table} (tenant_id${keys.map((k) => ', ' + k).join('')})
                 VALUES ($1${keys.map((_, i) => `, $${i + 2}`).join('')}) RETURNING *`;
    const { rows } = await db.query(sql, [req.user.tenantId, ...keys.map((k) => values[k])]);
    res.status(201).json(rows[0]);
  }));

  router.patch('/:id', wrap(async (req, res) => {
    const id = parseId(req.params.id);
    const { values, error } = sanitize(req.body, spec, { partial: true });
    if (error) throw new HttpError(400, error);
    const keys = Object.keys(values).filter((k) => cols.includes(k));
    if (!keys.length) throw new HttpError(400, 'Nothing to update');
    await checkRefs(req.user.tenantId, values);
    if (check) check(values);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await db.query(
      `UPDATE ${table} SET ${sets} WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, req.user.tenantId, ...keys.map((k) => values[k])]
    );
    if (!rows[0]) throw new HttpError(404, 'Not found');
    res.json(rows[0]);
  }));

  router.delete('/:id', wrap(async (req, res) => {
    const { rowCount } = await db.query(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2`, [parseId(req.params.id), req.user.tenantId]);
    if (!rowCount) throw new HttpError(404, 'Not found');
    res.status(204).end();
  }));

  return router;
}

module.exports = { crud, parseId, assertOwned, checkRefs };
