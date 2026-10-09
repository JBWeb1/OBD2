const test = require('node:test');
const assert = require('node:assert/strict');
const { start, db } = require('./helpers');
const { outbox } = require('../src/lib/mailer');
const { runReminders } = require('../src/lib/reminders');
const { signature } = require('../src/lib/payfast');
const { encrypt, decrypt } = require('../src/lib/secrets');
const { convert } = require('../src/scripts/import-dtc');

let ctx, A, B, cust, veh;
test.before(async () => {
  ctx = await start();
  A = await ctx.register('Shop A', 'a@x.com'); B = await ctx.register('Shop B', 'b@x.com');
  cust = (await ctx.call('POST', '/customers', { token: A, body: { first_name: 'Cara', email: 'cara@x.com', phone: '082 555 0101' } })).body;
  veh = (await ctx.call('POST', '/vehicles', { token: A, body: { make: 'VW', model: 'Polo', customer_id: cust.id } })).body;
});
test.after(() => ctx.close());

test('jobs: tenant-scoped, assignee must be on the team', async () => {
  const j = await ctx.call('POST', '/jobs', { token: A, body: { title: 'Service', vehicle_id: veh.id, customer_id: cust.id, scheduled_for: '2026-11-01T09:00:00Z' } });
  assert.equal(j.status, 201);
  const up = await ctx.call('PATCH', `/jobs/${j.body.id}`, { token: A, body: { status: 'in_progress' } });
  assert.equal(up.body.status, 'in_progress');
  assert.equal((await ctx.call('PATCH', `/jobs/${j.body.id}`, { token: A, body: { status: 'bogus' } })).status, 400);
  const bUser = (await db.query(`SELECT id FROM users WHERE email='b@x.com'`)).rows[0].id;
  assert.equal((await ctx.call('PATCH', `/jobs/${j.body.id}`, { token: A, body: { assigned_to: bUser } })).status, 400, 'cannot assign another shop\'s user');
  assert.equal((await ctx.call('GET', '/jobs', { token: B })).body.length, 0);
  assert.equal((await ctx.call('GET', '/jobs', { token: A })).body[0].vehicle.model, 'Polo');
});

test('parts & stock: invoice decrements, delete restores, no overselling', async () => {
  const p = (await ctx.call('POST', '/parts', { token: A, body: { name: 'Oil filter', sku: 'OF1', cost_cents: 5000, price_cents: 9000, qty: 5, min_qty: 2 } })).body;
  assert.equal((await ctx.call('POST', '/parts', { token: A, body: { name: 'Bad', qty: -1 } })).status, 400);
  const inv = await ctx.call('POST', '/invoices', { token: A, body: { customer_id: cust.id, items: [{ description: 'Oil filter', qty: 3, unit_cents: 9000, part_id: p.id }] } });
  assert.equal(inv.status, 201);
  let list = (await ctx.call('GET', '/parts', { token: A })).body;
  assert.equal(list[0].qty, 2); assert.equal(list[0].low_stock, true);
  const over = await ctx.call('POST', '/invoices', { token: A, body: { items: [{ description: 'Oil filter', qty: 3, unit_cents: 9000, part_id: p.id }] } });
  assert.equal(over.status, 400);
  assert.equal((await ctx.call('GET', '/parts', { token: A })).body[0].qty, 2, 'failed invoice leaves stock untouched');
  assert.equal((await ctx.call('PATCH', `/invoices/${inv.body.id}`, { token: A, body: { items: [{ description: 'x', qty: 1, unit_cents: 1 }] } })).status, 400);
  await ctx.call('DELETE', `/invoices/${inv.body.id}`, { token: A });
  assert.equal((await ctx.call('GET', '/parts', { token: A })).body[0].qty, 5, 'deleting restores stock');
  assert.equal((await ctx.call('POST', `/parts/${p.id}/adjust`, { token: A, body: { delta: -9 } })).status, 400);
  assert.equal((await ctx.call('POST', `/parts/${p.id}/adjust`, { token: B, body: { delta: 1 } })).status, 400, 'other shop cannot touch it');
  const imp = await ctx.call('POST', '/parts/import', { token: A, body: { rows: [{ name: 'Brake pads', qty: 4 }, { name: 'Wipers', qty: 10, price_cents: 15000 }] } });
  assert.equal(imp.body.imported, 2);
});

test('inspection photos: validated, tenant-scoped, served back', async () => {
  const insp = (await ctx.call('POST', '/inspections', { token: A, body: { vehicle_id: veh.id, type: 'service' } })).body;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.equal((await ctx.call('POST', `/inspections/${insp.id}/photos`, { token: A, body: { mime: 'text/html', data: png } })).status, 400);
  assert.equal((await ctx.call('POST', `/inspections/${insp.id}/photos`, { token: B, body: { mime: 'image/png', data: png } })).status, 400);
  const ph = await ctx.call('POST', `/inspections/${insp.id}/photos`, { token: A, body: { mime: 'image/png', data: png, item: 'Front tyre' } });
  assert.equal(ph.status, 201);
  const r = await fetch(`${ctx.base}/inspections/${insp.id}/photos/${ph.body.id}/image`, { headers: { Authorization: 'Bearer ' + A } });
  assert.equal(r.headers.get('content-type'), 'image/png'); assert.ok((await r.arrayBuffer()).byteLength > 20);
  assert.equal((await fetch(`${ctx.base}/inspections/${insp.id}/photos/${ph.body.id}/image`, { headers: { Authorization: 'Bearer ' + B } })).status, 404);
});

test('a quote converts to an invoice only once (no duplicate invoice or double stock deduction)', async () => {
  const p = (await ctx.call('POST', '/parts', { token: A, body: { name: 'Spark plug', qty: 8 } })).body;
  const q = (await ctx.call('POST', '/invoices', { token: A, body: { kind: 'quote', customer_id: cust.id, items: [{ description: 'Spark plug', qty: 4, unit_cents: 8000, part_id: p.id }] } })).body;
  const [c1, c2] = await Promise.all([1, 2].map(() => ctx.call('POST', `/invoices/${q.id}/convert`, { token: A })));
  assert.deepEqual([c1.status, c2.status].sort(), [201, 409]);
  assert.equal((await ctx.call('GET', `/parts/${p.id}`, { token: A })).body.qty, 4, 'stock taken once');
  assert.equal((await ctx.call('POST', `/invoices/${q.id}/convert`, { token: B })).status, 404, 'other shop cannot convert it');
});

test('scan stores readiness + freeze frame', async () => {
  const s = await ctx.call('POST', '/scans', { token: A, body: { vehicle_id: veh.id, protocol: 'CAN', readiness: { mil: true, monitors: [] }, freeze_frame: { dtc: 'P0301', values: { '0C': 1726 } }, dtcs: [{ code: 'P0301' }] } });
  assert.equal(s.status, 201);
  const got = await ctx.call('GET', `/scans/${s.body.id}`, { token: A });
  assert.equal(got.body.freeze_frame.dtc, 'P0301'); assert.equal(got.body.readiness.mil, true);
});

test('PDF invoice, emailing only to the customer on file', async () => {
  const inv = (await ctx.call('POST', '/invoices', { token: A, body: { customer_id: cust.id, vehicle_id: veh.id, items: [{ description: 'Service', qty: 1, unit_cents: 150000 }] } })).body;
  const r = await fetch(`${ctx.base}/invoices/${inv.id}/pdf`, { headers: { Authorization: 'Bearer ' + A } });
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await r.arrayBuffer()).slice(0, 5).toString(), '%PDF-');
  const before = outbox.length;
  const em = await ctx.call('POST', `/invoices/${inv.id}/email`, { token: A, body: { to: 'attacker@evil.com' } });
  assert.equal(em.body.to, 'cara@x.com', 'recipient comes from the customer record, not the request');
  const mail = outbox[outbox.length - 1];
  assert.equal(outbox.length, before + 1); assert.equal(mail.attachments[0].filename, `Invoice-${String(inv.number).padStart(4, '0')}.pdf`);
  assert.equal((await fetch(`${ctx.base}/invoices/${inv.id}/pdf`, { headers: { Authorization: 'Bearer ' + B } })).status, 404);
  const rep = await fetch(`${ctx.base}/reports/vehicle/${veh.id}/pdf`, { headers: { Authorization: 'Bearer ' + A } });
  assert.equal(Buffer.from(await rep.arrayBuffer()).slice(0, 5).toString(), '%PDF-');
});

test('customer payment link uses the workshop\'s own PayFast account and ITN marks it paid', async () => {
  const inv = (await ctx.call('POST', '/invoices', { token: A, body: { customer_id: cust.id, items: [{ description: 'Brakes', qty: 1, unit_cents: 250000 }] } })).body;
  assert.equal((await ctx.call('POST', `/invoices/${inv.id}/pay-link`, { token: A })).status, 400, 'needs workshop PayFast details first');
  const prof = await ctx.call('PUT', '/shop', { token: A, body: { pf_merchant_id: '10000100', pf_merchant_key: '46f0cd694581a', pf_passphrase: 'shopsecret' } });
  assert.equal(prof.body.pf_passphrase_set, true); assert.equal(prof.body.pf_passphrase, undefined, 'secrets never returned');
  const link = (await ctx.call('POST', `/invoices/${inv.id}/pay-link`, { token: A })).body.url;
  const token = link.split('#')[1];
  const pub = await ctx.call('GET', `/public/invoice/${token}`);
  assert.equal(pub.body.total_cents, 250000); assert.equal(pub.body.canPay, true);
  assert.equal(pub.body.customer_id, undefined);
  assert.equal((await ctx.call('GET', '/public/invoice/' + 'a'.repeat(32))).status, 404);
  const co = (await ctx.call('POST', `/public/invoice/${token}/checkout`)).body;
  const { signature: sig, ...rest } = co.fields;
  assert.equal(co.fields.merchant_id, '10000100'); assert.equal(co.fields.amount, '2500.00');
  assert.equal(sig, signature(Object.entries(rest), 'shopsecret'));
  require('../src/routes/billing').itn.skipNetwork = true;
  const post = async (pairs) => { await fetch(ctx.itnUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pairs).toString() }); await new Promise((x) => setTimeout(x, 120)); };
  const base = [['merchant_id', '10000100'], ['payment_status', 'COMPLETE'], ['amount_gross', '2500.00'], ['custom_str1', 'inv'], ['custom_str2', token]];
  await post([...base, ['signature', signature(base, 'WRONG')]]);
  assert.equal((await ctx.call('GET', `/invoices/${inv.id}`, { token: A })).body.status, 'outstanding', 'bad signature ignored');
  const cheap = base.map(([k, v]) => (k === 'amount_gross' ? [k, '1.00'] : [k, v]));
  await post([...cheap, ['signature', signature(cheap, 'shopsecret')]]);
  assert.equal((await ctx.call('GET', `/invoices/${inv.id}`, { token: A })).body.status, 'outstanding', 'underpayment ignored');
  await post([...base, ['signature', signature(base, 'shopsecret')]]);
  assert.equal((await ctx.call('GET', `/invoices/${inv.id}`, { token: A })).body.status, 'paid');
  // a cancelled invoice keeps its link but can no longer be paid online
  const inv2 = (await ctx.call('POST', '/invoices', { token: A, body: { customer_id: cust.id, items: [{ description: 'Tyres', qty: 1, unit_cents: 100000 }] } })).body;
  const t2 = (await ctx.call('POST', `/invoices/${inv2.id}/pay-link`, { token: A })).body.url.split('#')[1];
  await ctx.call('PATCH', `/invoices/${inv2.id}`, { token: A, body: { status: 'cancelled' } });
  assert.equal((await ctx.call('GET', `/public/invoice/${t2}`)).body.canPay, false);
  assert.equal((await ctx.call('POST', `/public/invoice/${t2}/checkout`)).status, 400);
});

test('service reminders: opt-in, sent once, SMS + email, idempotent', async () => {
  const when = new Date('2026-10-10T07:00:00Z');
  await ctx.call('PATCH', `/vehicles/${veh.id}`, { token: A, body: { next_service_on: '2026-10-14' } });
  outbox.length = 0;
  assert.equal((await runReminders(when)).sent, 0, 'off by default');
  await ctx.call('PUT', '/shop', { token: A, body: { reminders_enabled: true } });
  const r1 = await runReminders(when);
  assert.equal(r1.sent, 1);
  assert.deepEqual(outbox.map((m) => m.type).sort(), ['email', 'sms']);
  assert.match(outbox.find((m) => m.type === 'sms').to, /^\+2782555/);
  assert.equal((await runReminders(new Date('2026-10-11T07:00:00Z'))).sent, 0, 'not re-sent for the same service date');
  await ctx.call('PATCH', `/vehicles/${veh.id}`, { token: A, body: { next_service_on: '2027-10-14' } });
  await db.query(`UPDATE tenants SET trial_ends_at = '2030-01-01' WHERE name = 'Shop A'`); // keep the trial running for this check
  assert.equal((await runReminders(new Date('2027-10-10T07:00:00Z'))).sent, 1, 'next year\'s service reminds again');
  // a shop whose trial has run out doesn't send (the platform pays for the SMS)
  await ctx.call('PATCH', `/vehicles/${veh.id}`, { token: A, body: { next_service_on: '2028-10-14' } });
  await db.query(`UPDATE tenants SET trial_ends_at = '2028-10-01' WHERE name = 'Shop A'`);
  assert.equal((await runReminders(new Date('2028-10-10T07:00:00Z'))).sent, 0, 'expired trial');
  await db.query(`UPDATE tenants SET plan_status = 'active' WHERE name = 'Shop A'`);
  assert.equal((await runReminders(new Date('2028-10-10T07:00:00Z'))).sent, 1, 'paid plan sends');
});

test('secrets round-trip and DTC CSV import', () => {
  assert.equal(decrypt(encrypt('p@ss word')), 'p@ss word');
  assert.notEqual(encrypt('x'), encrypt('x'));
  const { out, skipped } = convert('code,description,severity\nP0171,"System too lean, bank 1",warning\nZZZ,bad,\nP1234,Maker specific,critical\n');
  assert.equal(out.length, 2); assert.equal(out[0].name, 'System too lean, bank 1'); assert.equal(out[1].sev, 'critical'); assert.deepEqual(skipped, ['ZZZ']);
});
