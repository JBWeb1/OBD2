const test = require('node:test');
const assert = require('node:assert/strict');
const { start, db } = require('./helpers');
const { signature } = require('../src/lib/payfast');

let ctx, A, B;
test.before(async () => {
  ctx = await start();
  A = await ctx.register('Shop A', 'a@x.com');
  B = await ctx.register('Shop B', 'b@x.com');
});
test.after(() => ctx.close());

test('auth: duplicate email, bad login, me', async () => {
  const dup = await ctx.call('POST', '/auth/register', { body: { shopName: 'Z', name: 'Z', email: 'a@x.com', password: 'password123', acceptTerms: true } });
  assert.equal(dup.status, 409);
  const bad = await ctx.call('POST', '/auth/login', { body: { email: 'a@x.com', password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await ctx.call('POST', '/auth/login', { body: { email: 'a@x.com', password: 'password123' } });
  assert.equal(ok.status, 200);
  const me = await ctx.call('GET', '/auth/me', { token: ok.body.token });
  assert.equal(me.body.tenant.planStatus, 'trial');
  assert.equal((await ctx.call('GET', '/customers')).status, 401);
});

test('tenant isolation', async () => {
  const c = await ctx.call('POST', '/customers', { token: A, body: { first_name: 'Alice' } });
  assert.equal(c.status, 201);
  const v = await ctx.call('POST', '/vehicles', { token: A, body: { make: 'Volkswagen', model: 'Polo', customer_id: c.body.id } });
  assert.equal(v.status, 201);
  assert.deepEqual((await ctx.call('GET', '/customers', { token: B })).body, []);
  assert.equal((await ctx.call('GET', `/customers/${c.body.id}`, { token: B })).status, 404);
  assert.equal((await ctx.call('PATCH', `/customers/${c.body.id}`, { token: B, body: { first_name: 'Hacked' } })).status, 404);
  assert.equal((await ctx.call('DELETE', `/vehicles/${v.body.id}`, { token: B })).status, 404);
  // B cannot attach its records to A's customer
  assert.equal((await ctx.call('POST', '/vehicles', { token: B, body: { make: 'X', model: 'Y', customer_id: c.body.id } })).status, 400);
  assert.equal((await ctx.call('GET', `/reports/vehicle/${v.body.id}`, { token: B })).status, 404);
  assert.equal((await ctx.call('GET', `/reports/vehicle/${v.body.id}`, { token: A })).status, 200);
});

test('invoices: per-tenant numbering, totals, overdue, convert', async () => {
  const items = [{ description: 'Diagnostic', qty: 1, unit_cents: 50000 }, { description: 'Part', qty: 2, unit_cents: 12500 }];
  const i1 = await ctx.call('POST', '/invoices', { token: A, body: { items, due_on: '2000-01-01' } });
  const i2 = await ctx.call('POST', '/invoices', { token: A, body: { items } });
  const b1 = await ctx.call('POST', '/invoices', { token: B, body: { items } });
  assert.equal(i1.body.total_cents, 75000);
  assert.deepEqual([i1.body.number, i2.body.number, b1.body.number], [1, 2, 1]);
  const list = await ctx.call('GET', '/invoices', { token: A });
  assert.equal(list.body.find((x) => x.id === i1.body.id).status, 'overdue');
  const paid = await ctx.call('PATCH', `/invoices/${i2.body.id}`, { token: A, body: { status: 'paid' } });
  assert.equal(paid.body.status, 'paid');
  assert.equal((await ctx.call('POST', '/invoices', { token: A, body: { items: [] } })).status, 400);
  const q = await ctx.call('POST', '/invoices', { token: A, body: { kind: 'quote', items } });
  const conv = await ctx.call('POST', `/invoices/${q.body.id}/convert`, { token: A });
  assert.equal(conv.body.kind, 'invoice');
});

test('scans: plan limit enforced, demo scans free, DTC logging', async () => {
  const v = (await ctx.call('POST', '/vehicles', { token: B, body: { make: 'BMW', model: '320d' } })).body;
  const bad = await ctx.call('POST', '/scans', { token: B, body: { vehicle_id: v.id, dtcs: [{ code: 'ZZZZZ' }] } });
  assert.equal(bad.status, 400);
  const first = await ctx.call('POST', '/scans', { token: B, body: { vehicle_id: v.id, protocol: 'ISO 15765-4', dtcs: [{ code: 'P0420' }] } });
  assert.equal(first.status, 201);
  const dtcs = await ctx.call('GET', `/dtc?vehicle_id=${v.id}`, { token: B });
  assert.equal(dtcs.body[0].code, 'P0420');
  await ctx.call('POST', '/scans', { token: B, body: { vehicle_id: v.id, dtcs: [{ code: 'P0420' }] } });
  assert.equal((await ctx.call('GET', `/dtc?vehicle_id=${v.id}`, { token: B })).body.length, 1, 'no duplicate open code');
  // exhaust starter limit (100) quickly via SQL, then API must refuse
  await db.query(`INSERT INTO scan_sessions (tenant_id, source) SELECT t.id, 'adapter' FROM tenants t, generate_series(1,100) WHERE t.name='Shop B'`).catch(async () => {
    for (let i = 0; i < 100; i++) await db.query(`INSERT INTO scan_sessions (tenant_id, source) SELECT id, 'adapter' FROM tenants WHERE name='Shop B'`);
  });
  const over = await ctx.call('POST', '/scans', { token: B, body: { vehicle_id: v.id } });
  assert.equal(over.status, 402);
  assert.equal(over.body.code, 'scan_limit');
  assert.equal((await ctx.call('POST', '/scans', { token: B, body: { vehicle_id: v.id, source: 'demo' } })).status, 201);
  const cleared = await ctx.call('POST', '/dtc/clear', { token: B, body: { vehicle_id: v.id } });
  assert.equal(cleared.body.cleared, 1);
});

test('team: user limit by plan, admin only', async () => {
  const add = (email) => ctx.call('POST', '/users', { token: A, body: { name: 'T', email, password: 'password123' } });
  assert.equal((await add('t1@x.com')).status, 201);
  const second = await add('t2@x.com');
  assert.equal(second.status, 402);
  assert.equal(second.body.code, 'user_limit');
  const tech = (await ctx.call('POST', '/auth/login', { body: { email: 't1@x.com', password: 'password123' } })).body.token;
  assert.equal((await ctx.call('GET', '/users', { token: tech })).status, 403);
});

test('trial expiry makes the account read-only (402 on writes, reads OK, billing reachable)', async () => {
  await db.query(`UPDATE tenants SET trial_ends_at = now() - interval '1 day' WHERE name = 'Shop A'`);
  assert.equal((await ctx.call('POST', '/customers', { token: A, body: { first_name: 'Late' } })).status, 402);
  assert.equal((await ctx.call('GET', '/customers', { token: A })).status, 200);
  const b = await ctx.call('GET', '/billing', { token: A });
  assert.equal(b.status, 200);
  assert.equal(b.body.active, false);
  const co = await ctx.call('POST', '/billing/checkout', { token: A, body: { plan: 'pro' } });
  assert.equal(co.status, 200);
  assert.match(co.body.action, /sandbox\.payfast\.co\.za/);
});

test('payfast: signature matches the documented algorithm and checkout is signed', async () => {
  // known value computed independently: md5 of the exact query string below
  const crypto = require('crypto');
  const pairs = [['merchant_id', '10000100'], ['item_name', 'Test Item'], ['amount', '10.00']];
  const expected = crypto.createHash('md5').update('merchant_id=10000100&item_name=Test+Item&amount=10.00&passphrase=abc').digest('hex');
  assert.equal(signature(pairs, 'abc'), expected);
  const co = await ctx.call('POST', '/billing/checkout', { token: A, body: { plan: 'starter' } });
  const f = co.body.fields;
  const { signature: sig, ...rest } = f;
  assert.equal(sig, signature(Object.entries(rest), 'jt7NOE43FZPn'));
  assert.equal(f.recurring_amount, '499.00');
});

test('payfast ITN: bad signature ignored, valid COMPLETE activates plan', async () => {
  const billing = require('../src/routes/billing');
  billing.itn.skipNetwork = true; // network validation is exercised against the sandbox, not in unit tests
  const tid = (await db.query(`SELECT id FROM tenants WHERE name='Shop A'`)).rows[0].id;
  const send = async (fields) => {
    const body = new URLSearchParams(fields).toString();
    const base = ctx.call.toString && `http://127.0.0.1:${ctx.port || ''}`;
    return body;
  };
  void send; void tid;
  const pairs = [['m_payment_id', 'x'], ['payment_status', 'COMPLETE'], ['amount_gross', '999.00'], ['custom_str1', String(tid)], ['custom_str2', 'pro']];
  const good = new URLSearchParams([...pairs, ['signature', signature(pairs, 'jt7NOE43FZPn')]]).toString();
  const forged = new URLSearchParams([...pairs, ['signature', 'deadbeefdeadbeefdeadbeefdeadbeef']]).toString();
  const url = ctx.itnUrl;
  for (const b of [forged]) await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await db.query('SELECT plan_status FROM tenants WHERE id=$1', [tid])).rows[0].plan_status, 'trial');
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: good });
  await new Promise((r) => setTimeout(r, 100));
  const t = (await db.query('SELECT plan, plan_status FROM tenants WHERE id=$1', [tid])).rows[0];
  assert.deepEqual(t, { plan: 'pro', plan_status: 'active' });
  assert.equal((await ctx.call('POST', '/customers', { token: A, body: { first_name: 'Back' } })).status, 201);
});
