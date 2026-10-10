const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const updates = require('../src/lib/updates');
const { version } = require('../src/lib/version');

test('semver compare handles v-prefix, shorter versions and build/pre-release suffixes', () => {
  assert.equal(updates.semverCmp('1.2.0', '1.1.9'), 1);
  assert.equal(updates.semverCmp('1.0.0', '1.0.0'), 0);
  assert.equal(updates.semverCmp('v1.0', '1.0.1'), -1);
  assert.equal(updates.semverCmp('2.0.0-rc1', '2.0.0'), 0, 'pre-release ignored');
  assert.equal(updates.semverCmp('1.10.0', '1.9.0'), 1, 'numeric, not lexical');
});

test('parseFeed accepts a plain feed and a GitHub release shape', () => {
  assert.deepEqual(updates.parseFeed({ version: '1.3.0', url: 'x', notes: 'n' }), { version: '1.3.0', url: 'x', notes: 'n' });
  assert.equal(updates.parseFeed({ tag_name: 'v2.1.0', html_url: 'h', name: 'Release 2.1' }).version, '2.1.0');
  assert.equal(updates.parseFeed({}), null);
  assert.equal(updates.parseFeed('nope'), null);
});

test('update check: disabled by default, reports newer, degrades on failure, and caches', async () => {
  updates._reset();
  const { config } = require('../src/config');
  config.updateCheckUrl = '';
  // disabled
  let r = await updates.check({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.enabled, false); assert.equal(r.updateAvailable, false); assert.equal(r.current, version);

  // enabled via config override (same singleton updates.js reads)
  config.updateCheckUrl = 'https://example.test/latest.json';
  let calls = 0;
  const feed = (v) => async () => { calls++; return { ok: true, json: async () => ({ version: v, url: 'https://example.test/r', notes: 'stuff' }) }; };
  updates._reset();
  r = await updates.check({ fetchImpl: feed('99.0.0'), now: 1000 });
  assert.equal(r.enabled, true); assert.equal(r.updateAvailable, true); assert.equal(r.latest, '99.0.0'); assert.equal(r.url, 'https://example.test/r');
  // cached within the hour: no second fetch
  r = await updates.check({ fetchImpl: feed('1.0.0'), now: 1000 + 60_000 });
  assert.equal(calls, 1, 'cached'); assert.equal(r.latest, '99.0.0');
  // same version -> not an update
  updates._reset();
  r = await updates.check({ fetchImpl: feed(version), now: 2000, force: true });
  assert.equal(r.updateAvailable, false);
  // network failure degrades to current only, never throws
  updates._reset();
  r = await updates.check({ fetchImpl: async () => { throw new Error('offline'); }, now: 3000 });
  assert.equal(r.updateAvailable, false); assert.equal(r.current, version); assert.equal(r.latest, null);
  config.updateCheckUrl = '';
});

let ctx, admin, tech;
test.before(async () => {
  ctx = await start();
  admin = await ctx.register('Ver Shop', 'ver@x.com');
  // a technician (non-admin) in the same shop
  await ctx.call('POST', '/users', { token: admin, body: { name: 'Tech', email: 'tech@ver.com', role: 'technician', password: 'password123' } });
  tech = (await ctx.call('POST', '/auth/login', { body: { email: 'tech@ver.com', password: 'password123' } })).body.token;
});
test.after(() => ctx.close());

test('API: /api/version is public and every response carries X-App-Version', async () => {
  const r = await fetch(`${ctx.base}/version`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.version, version);
  assert.equal(r.headers.get('x-app-version'), body.tag);
  // header present on an authenticated endpoint too
  const h = await fetch(`${ctx.base}/reports/summary`, { headers: { Authorization: 'Bearer ' + admin } });
  assert.ok(h.headers.get('x-app-version'));
});

test('API: /api/updates is admin-only and reports current version when checks are off', async () => {
  assert.equal((await ctx.call('GET', '/updates', { token: tech })).status, 403, 'technician cannot check');
  const r = await ctx.call('GET', '/updates', { token: admin });
  assert.equal(r.status, 200); assert.equal(r.body.current, version); assert.equal(r.body.enabled, false); assert.equal(r.body.updateAvailable, false);
});
