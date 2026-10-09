const test = require('node:test');
const assert = require('node:assert/strict');
const { start, db } = require('./helpers');
const { outbox } = require('../src/lib/mailer');
const { signToken } = require('../src/middleware/auth');

let ctx;
test.before(async () => { ctx = await start(); });
test.after(() => ctx.close());
const tokenFrom = (kind) => [...outbox].reverse().find((m) => m.type === 'email' && m.text.includes(`#${kind}=`)).text.match(new RegExp(`#${kind}=([0-9a-f]{64})`))[1];

test('registration requires accepting terms and sends a verification email', async () => {
  const no = await ctx.call('POST', '/auth/register', { body: { shopName: 'S', name: 'N', email: 'n@x.com', password: 'password123' } });
  assert.equal(no.status, 400);
  const r = await ctx.call('POST', '/auth/register', { body: { shopName: 'S', name: 'N', email: 'n@x.com', password: 'password123', acceptTerms: true } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.emailVerified, false);
  await new Promise((x) => setTimeout(x, 50));
  const t = tokenFrom('verify');
  assert.equal((await ctx.call('POST', '/auth/verify', { body: { token: 'f'.repeat(64) } })).status, 400);
  assert.equal((await ctx.call('POST', '/auth/verify', { body: { token: t } })).status, 200);
  assert.equal((await ctx.call('POST', '/auth/verify', { body: { token: t } })).status, 400, 'single use');
  assert.equal((await ctx.call('GET', '/auth/me', { token: r.body.token })).body.emailVerified, true);
});

test('password reset: no account enumeration, single-use link, new password works', async () => {
  const oldSession = (await ctx.call('POST', '/auth/login', { body: { email: 'n@x.com', password: 'password123' } })).body.token;
  const before = outbox.length;
  const ghost = await ctx.call('POST', '/auth/forgot', { body: { email: 'nobody@x.com' } });
  assert.equal(ghost.status, 200);
  await new Promise((x) => setTimeout(x, 30));
  assert.equal(outbox.length, before, 'no email for unknown address');
  await ctx.call('POST', '/auth/forgot', { body: { email: 'n@x.com' } });
  await new Promise((x) => setTimeout(x, 50));
  const t = tokenFrom('reset');
  assert.equal((await ctx.call('POST', '/auth/reset', { body: { token: t, password: 'short' } })).status, 400);
  assert.equal((await ctx.call('POST', '/auth/reset', { body: { token: t, password: 'brandnewpass1' } })).status, 200);
  assert.equal((await ctx.call('POST', '/auth/reset', { body: { token: t, password: 'anotherpass12' } })).status, 400);
  assert.equal((await ctx.call('POST', '/auth/login', { body: { email: 'n@x.com', password: 'password123' } })).status, 401);
  assert.equal((await ctx.call('POST', '/auth/login', { body: { email: 'n@x.com', password: 'brandnewpass1' } })).status, 200);
  assert.equal((await ctx.call('GET', '/auth/me', { token: oldSession })).status, 401, 'reset signs out existing sessions');
  await ctx.call('POST', '/auth/forgot', { body: { email: 'n@x.com' } });
  await new Promise((x) => setTimeout(x, 50));
  const t2 = tokenFrom('reset');
  await db.query(`UPDATE auth_tokens SET expires_at = '2000-01-01'`);
  assert.equal((await ctx.call('POST', '/auth/reset', { body: { token: t2, password: 'whatever1234' } })).status, 400, 'expired link rejected');
});

test('change password: needs the current one, signs out other sessions, keeps this one', async () => {
  const login = () => ctx.call('POST', '/auth/login', { body: { email: 'n@x.com', password: 'brandnewpass1' } });
  const laptop = (await login()).body.token;
  const phone = signToken((await db.query(`SELECT * FROM users WHERE email = 'n@x.com'`)).rows[0]); // a second signed-in device
  assert.equal((await ctx.call('POST', '/auth/change-password', { body: { currentPassword: 'brandnewpass1', newPassword: 'x'.repeat(10) } })).status, 401);
  assert.equal((await ctx.call('POST', '/auth/change-password', { token: laptop, body: { currentPassword: 'wrong', newPassword: 'changedpass99' } })).status, 403);
  assert.equal((await ctx.call('POST', '/auth/change-password', { token: laptop, body: { currentPassword: 'brandnewpass1', newPassword: 'short' } })).status, 400);
  const ch = await ctx.call('POST', '/auth/change-password', { token: laptop, body: { currentPassword: 'brandnewpass1', newPassword: 'changedpass99' } });
  assert.equal(ch.status, 200);
  assert.equal((await ctx.call('GET', '/auth/me', { token: phone })).status, 401, 'other session signed out');
  assert.equal((await ctx.call('GET', '/auth/me', { token: laptop })).status, 401, 'old token of this session too');
  assert.equal((await ctx.call('GET', '/auth/me', { token: ch.body.token })).status, 200, 'fresh token works');
  assert.equal((await login()).status, 401);
  // put it back for the tests below
  await ctx.call('POST', '/auth/change-password', { token: ch.body.token, body: { currentPassword: 'changedpass99', newPassword: 'brandnewpass1' } });
});

test('shop profile, audit trail, export and erasure', async () => {
  const token = (await ctx.call('POST', '/auth/login', { body: { email: 'n@x.com', password: 'brandnewpass1' } })).body.token;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.equal((await ctx.call('PUT', '/shop', { token, body: { logo: 'javascript:alert(1)' } })).status, 400);
  const up = await ctx.call('PUT', '/shop', { token, body: { name: 'Better Motors', phone: '021 555 0100', vat_number: '4123456789', logo: png, reminders_enabled: true } });
  assert.equal(up.status, 200);
  assert.equal(up.body.name, 'Better Motors'); assert.equal(up.body.reminders_enabled, true);
  await ctx.call('POST', '/customers', { token, body: { first_name: 'Audit' } });
  await new Promise((x) => setTimeout(x, 80));
  const log = await ctx.call('GET', '/shop/audit', { token });
  assert.ok(log.body.some((l) => l.action === 'POST /customers' && l.user_name === 'N'));
  assert.ok(!JSON.stringify(log.body).includes('Audit'), 'bodies are not stored in the audit trail');
  const exp = await ctx.call('GET', '/shop/export', { token });
  assert.equal(exp.body.customers.length, 1);
  assert.equal((await ctx.call('DELETE', '/shop', { token, body: { password: 'wrong', confirm: 'Better Motors' } })).status, 403);
  assert.equal((await ctx.call('DELETE', '/shop', { token, body: { password: 'brandnewpass1', confirm: 'nope' } })).status, 400);
  assert.equal((await ctx.call('DELETE', '/shop', { token, body: { password: 'brandnewpass1', confirm: 'Better Motors' } })).status, 204);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM customers')).rows[0].n, 0);
  assert.equal((await ctx.call('GET', '/customers', { token })).status, 401);
});

test('health endpoint checks the database', async () => {
  assert.equal((await ctx.call('GET', '/health')).body.ok, true);
});
