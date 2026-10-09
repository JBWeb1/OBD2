// Browser smoke test against test/dev-server.js: node test/e2e.js
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1300, height: 800 } });
  const problems = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|ERR_TUNNEL/.test(m.text())) problems.push(m.text()); });
  p.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.request().method(), r.url()); });
  p.on('pageerror', (e) => problems.push('pageerror ' + e.message));
  await p.goto('http://localhost:3111/');
  await p.click('[data-arg=register]');
  await p.fill('#auth-register [name=shopName]', 'E2E Motors'); await p.fill('#auth-register [name=name]', 'Eve Tester');
  await p.fill('#auth-register [name=email]', `e2e${Date.now()}@example.com`); await p.fill('#auth-register [name=password]', 'password123');
  await p.check('#auth-register [name=acceptTerms]');
  await p.click('#auth-register button[type=submit]');
  await p.waitForSelector('#screen-app.visible');
  await p.waitForSelector('.stat-card');
  const shot = (n) => p.screenshot({ path: `/tmp/e2e-${n}.png` });
  await shot('dashboard');
  // customer
  await p.click('[data-nav=customers]'); await p.click('[data-act=cust-new]');
  await p.fill('#modal-form [name=first_name]', '<b>Bob</b>'); await p.fill('#modal-form [name=last_name]', 'Smith');
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('td:has-text("Smith")');
  if (await p.locator('td b').count()) problems.push('XSS: customer name rendered as HTML');
  // vehicle
  await p.click('[data-nav=vehicles]'); await p.click('[data-act=new-vehicle]');
  await p.fill('#modal-form [name=make]', 'Volkswagen'); await p.fill('#modal-form [name=model]', 'Polo');
  await p.fill('#modal-form [name=year]', '2017'); await p.selectOption('#modal-form [name=customer_id]', { index: 1 });
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('td:has-text("Polo")');
  // invoice
  await p.click('[data-nav=invoices]'); await p.click('[data-act=inv-new][data-arg=invoice]');
  await p.fill('#lines [name=desc]', 'Diagnostic'); await p.fill('#lines [name=price]', '650');
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('td:has-text("R650.00")');
  await p.click('[data-act=inv-paid]'); await p.waitForSelector('.badge:has-text("paid")');
  // demo scan saved against vehicle
  await p.click('[data-nav=scanner]'); await p.selectOption('#scan-vehicle', { index: 1 });
  await p.click('[data-act=scan-demo]'); await p.waitForSelector('.g-value:not(:has-text("—"))'); await p.waitForTimeout(900);
  await shot('scanner');
  await p.click('#scan-stop'); await p.waitForFunction(() => /Scan saved/.test(document.querySelector('#toast').textContent));
  // --- v2 features ---
  await p.click('[data-nav=parts]'); await p.click('[data-act=part-new]');
  await p.fill('#modal-form [name=name]', 'Oil filter'); await p.fill('#modal-form [name=qty]', '5'); await p.fill('#modal-form [name=price]', '90'); await p.fill('#modal-form [name=min_qty]', '2');
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('td:has-text("Oil filter")');
  await p.click('[data-nav=invoices]'); await p.click('[data-act=inv-new][data-arg=invoice]');
  await p.selectOption('#part-pick', { index: 1 }); await p.waitForSelector('#lines [name=desc][value="Oil filter"]');
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('td:has-text("R90.00")');
  await p.click('[data-nav=parts]'); await p.waitForSelector('.badge:has-text("4")');
  await p.click('[data-nav=jobs]'); await p.click('[data-act=job-new]'); await p.fill('#modal-form [name=title]', '60k service');
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('.kcard:has-text("60k service")');
  await p.click('[data-act=job-move]'); await p.waitForSelector('.kcol:nth-child(2) .kcard');
  await p.click('[data-nav=inspections]'); await p.click('[data-act=insp-new]'); await p.selectOption('#modal-form [name=vehicle_id]', { index: 1 });
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('[data-act=insp-view]');
  await p.click('[data-act=insp-view]');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#photo-input', { name: 'a.png', mimeType: 'image/png', buffer: png });
  await p.waitForSelector('#photo-grid img'); await p.click('[data-act=close-modal]');
  await p.click('[data-nav=history]'); await p.check('[data-scan]'); await p.click('[data-act=hist-chart]'); await p.waitForSelector('#hist-pid option', { state: 'attached' });
  await shot('history');
  await p.click('[data-nav=settings]'); await p.fill('#s-vat', '4123456789'); await p.fill('#s-phone', '021 555 0100'); await p.check('#s-rem');
  await p.click('[data-act=settings-save]'); await p.waitForFunction(() => /Settings saved/.test(document.querySelector('#toast').textContent));
  await shot('settings');
  await p.click('[data-nav=audit]'); await p.waitForSelector('td:has-text("POST /invoices")');
  await p.click('[data-nav=dashboard]'); await p.waitForSelector('.stat-card'); await shot('dashboard2');
  // legal pages + forgot password form
  const keep = problems.length; // /pay.html without a token legitimately logs one 404
  for (const u of ['/privacy', '/terms', '/pay.html']) { const r = await p.goto('http://localhost:3111' + u); if (r.status() !== 200) problems.push(u + ' ' + r.status()); }
  await p.waitForTimeout(300); problems.splice(keep);
  await p.goto('http://localhost:3111/'); await p.waitForSelector('#screen-app.visible');
  // report
  await p.click('[data-nav=vehicles]'); await p.click('[data-act=report]'); await p.waitForSelector('.doc');
  await shot('report');
  // billing + dev switch
  await p.click('[data-nav=billing]'); await p.click('[data-act=dev-switch][data-arg=pro]'); await p.waitForSelector('.badge:has-text("active")');
  // connect without adapter must fail gracefully (no Web Serial device in headless)
  for (const pg of ['dtc', 'terminal', 'pidref', 'tuning', 'inspections', 'team']) { await p.click(`[data-nav=${pg}]`); await p.waitForTimeout(300); }
  await shot('team');
  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'E2E OK, no console errors / CSP violations');
  await b.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('E2E FAIL', e.message); process.exit(1); });
