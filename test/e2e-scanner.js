// Browser test of the real scanner UI against a simulated ELM327 on Web Serial (CAN car).
// Covers: connect, supported-sensor picker, multi-PID live scan, adapter dropout + auto-reconnect,
// stop & save, fault codes, Mode 06.   Run: node test/dev-server.js & node test/e2e-scanner.js
const { chromium } = require(process.env.PW || 'playwright');

// Runs inside the page before the app loads.
function fakeSerial() {
  const VALUES = { '04': '66', '05': '52', '0B': 'DC', '0C': '1AF8', '0D': '3C', '0E': '9C', '0F': '41', '10': '2710', '2F': '80', '33': '64', '42': '3778', '46': '3C' };
  window.__thr = '80'; // throttle position byte; tests set FF for full throttle
  const FIXED = {
    ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK', ATDP: 'AUTO, ISO 15765-4 (CAN 11/500)',
    '0100': '4100983F8001', '0120': '412000022001', '0140': '414044000000',
    '0904': '013\n0:49040130334339\n1:3036303536444B\n2:2034343231', '0906': '490601A1B2C3D4',
    '090A': '017\n0:490A01426F7363\n1:68204D45443137\n2:2E352E35000000\n3:0000',
    '03': '4302030104 20'.replace(/ /g, ''), '07': '4700', '0A': '4A00',
    '0600': '460000000001', '0620': '462080000000', '0621': '013\n0:46218024007800\n1:0000C821810B03\n2:8400640320',
  };
  const log = (window.__sent = []);
  let reader = null; let open = false;
  const reply = (cmd) => {
    if (FIXED[cmd]) return FIXED[cmd];
    if (/^01([0-9A-F]{2})+$/.test(cmd)) {
      const pids = cmd.slice(2).match(/../g);
      // under full throttle the simulated engine revs from 2,000 rpm and airflow rises with it
      const wot = window.__thr === 'FF' ? (window.__wotAt = window.__wotAt || Date.now()) : (window.__wotAt = 0);
      const rev = wot ? Math.min(1, (Date.now() - wot) / 1500) : null;
      const h = (n, bytes) => Math.round(n).toString(16).toUpperCase().padStart(bytes * 2, '0');
      const val = (p) => (p === '11' ? window.__thr : rev == null ? VALUES[p] : p === '0C' ? h((2000 + 4000 * rev) * 4, 2) : p === '10' ? h((30 + 90 * rev) * 100, 2) : p === '0E' ? h((10 + 12 * rev + 64) * 2, 1) : VALUES[p]);
      const parts = pids.filter((p) => VALUES[p] || p === '11').map((p) => p + val(p));
      return parts.length ? '41' + parts.join('') : 'NO DATA';
    }
    return 'NO DATA';
  };
  const port = {
    getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
    async open() { open = true; },
    async close() { open = false; },
    get writable() { return { getWriter: () => ({ async write(b) { const cmd = new TextDecoder().decode(b).trim(); log.push(cmd); setTimeout(() => reader && reader.push(reply(cmd) + '\r\r>'), 5); }, releaseLock() {} }) }; },
    get readable() {
      return { getReader: () => {
        const q = []; let wait = null;
        reader = {
          push: (s) => { const v = new TextEncoder().encode(s); if (wait) { const w = wait; wait = null; w({ value: v, done: false }); } else q.push(v); },
          end: () => { if (wait) { const w = wait; wait = null; w({ done: true }); } },
        };
        const mine = reader;
        return { read: () => (q.length ? Promise.resolve({ value: q.shift(), done: false }) : new Promise((r) => { wait = r; })), async cancel() { mine.end(); }, releaseLock() {} };
      } };
    },
  };
  window.__dropAdapter = () => { open = false; reader && reader.end(); }; // cable pulled out
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, getPorts: async () => [port], addEventListener() {} } });
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const problems = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/fonts\.g|ERR_TUNNEL/.test(m.text())) problems.push(m.text()); });
  p.on('pageerror', (e) => problems.push('pageerror ' + e.message));
  await p.addInitScript(fakeSerial);
  const toast = (re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('#toast').textContent), re.source, { timeout: 15000 });
  await p.goto('http://localhost:3111/');
  await p.click('[data-arg=register]');
  await p.fill('#auth-register [name=shopName]', 'Scan Motors'); await p.fill('#auth-register [name=name]', 'Sam Scan');
  await p.fill('#auth-register [name=email]', `scan${Date.now()}@example.com`); await p.fill('#auth-register [name=password]', 'password123');
  await p.check('#auth-register [name=acceptTerms]'); await p.click('#auth-register button[type=submit]');
  await p.waitForSelector('#screen-app.visible');
  await p.click('[data-nav=vehicles]'); await p.click('[data-act=new-vehicle]');
  await p.fill('#modal-form [name=make]', 'Toyota'); await p.fill('#modal-form [name=model]', 'Corolla');
  await p.click('#modal-form button[type=submit]'); await p.waitForSelector('td:has-text("Corolla")');

  // connect: the picker should list exactly what the car supports (9 PIDs incl. battery voltage from the 0140 range)
  await p.click('[data-nav=scanner]'); await p.click('[data-act=toggle-conn]');
  await p.waitForSelector('#pid-pick :text("13 sensors this car supports")');
  if (!(await p.locator('#pid-pick [data-pid="0142"]').isChecked())) problems.push('battery voltage not selected by default');
  await p.locator('#pid-pick [data-pid="012F"]').check(); // add fuel level
  await p.selectOption('#scan-vehicle', { index: 1 });
  await p.click('[data-act=scan-start]');
  await p.waitForFunction(() => document.querySelector('#g-0142 .g-value')?.textContent === '14.2');
  await p.waitForFunction(() => document.querySelector('#g-0C .g-value, #g-010C .g-value')?.textContent === '1726');
  const multi = await p.evaluate(() => window.__sent.filter((c) => /^01([0-9A-F]{2}){2,}$/.test(c)).length);
  if (!multi) problems.push('live scan did not use multi-PID requests');
  // pull the cable mid-scan: the app reconnects by itself and keeps scanning
  await p.evaluate(() => window.__dropAdapter());
  await toast(/Reconnected/);
  const before = await p.evaluate(() => window.__sent.length);
  await p.waitForFunction((n) => window.__sent.length > n + 3, before);
  await p.screenshot({ path: '/tmp/e2e-scanner-live.png' });
  await p.click('#scan-stop'); await toast(/Scan saved/);

  // fault codes + Mode 06, saved to the vehicle
  await p.click('[data-nav=dtc]'); await p.selectOption('#dtc-vehicle', { index: 1 });
  await p.click('[data-act=dtc-read]'); await p.waitForSelector('#dtc-live td:has-text("P0301")');
  if (!(await p.locator('#dtc-live td:has-text("P0420")').count())) problems.push('second code missing');
  if (!(await p.locator('#dtc-live td:has-text("Cylinder 1 misfire")').count()) && !(await p.locator('#dtc-live td:has-text("misfire")').count())) problems.push('code description missing');
  await p.click('[data-act=mode06]'); await p.waitForSelector('#dtc-extra :text("1 of 2 passed")');
  await toast(/Monitor tests saved/);
  await p.screenshot({ path: '/tmp/e2e-scanner-mode06.png' });
  const usage = await p.evaluate(async () => (await (await fetch('/api/scans/usage', { headers: { Authorization: 'Bearer ' + localStorage.getItem('dos_token') } })).json()).used);
  if (usage !== 1) problems.push(`expected 1 live scan counted, got ${usage}`);

  // tuning: read the ECU software, record a full-throttle pull, see it on the page
  await p.click('[data-nav=tune]'); await p.selectOption('#tune-vehicle', { index: 1 });
  await p.waitForSelector('#tune-body :text("Tune readiness")');
  await p.click('[data-act=tune-ecu]'); await p.waitForSelector('#tune-body td:has-text("03C906056DK 4421")');
  if (!(await p.locator('#tune-body td:has-text("A1B2C3D4")').count())) problems.push('CVN not shown');
  // ECU tuning note: the read ECU name prefills the form; saving shows it back as "yours"
  await p.waitForSelector('#tune-body :text("Bosch MED17.5.5")');
  await p.click('[data-act=ecu-note]');
  await p.waitForSelector('#modal-form [name=ecu_name]');
  if ((await p.inputValue('#modal-form [name=ecu_name]')) !== 'Bosch MED17.5.5') problems.push('ECU name not prefilled from the read');
  await p.selectOption('#modal-form [name=access_method]', 'bench');
  await p.fill('#modal-form [name=tool]', 'KESS3');
  await p.selectOption('#modal-form [name=road_legal]', 'track');
  await p.fill('#modal-form [name=security_note]', 'OBD locked from MY2018 - bench only');
  await p.click('#modal-form button[type=submit]');
  await p.waitForSelector('#tune-body td:has-text("KESS3")');
  if (!(await p.locator('#tune-body :text("track only")').count())) problems.push('road-legal badge not shown');
  if (!(await p.locator('#tune-body .badge:has-text("yours")').count())) problems.push('own ECU note not marked yours');
  // modification log
  await p.click('[data-act=mod-new]');
  await p.waitForSelector('#modal-form [name=title]');
  await p.fill('#modal-form [name=title]', 'Catless downpipe');
  await p.selectOption('#modal-form [name=category]', 'exhaust');
  await p.selectOption('#modal-form [name=road_legal]', 'track');
  await p.click('#modal-form button[type=submit]');
  await p.waitForSelector('#tune-body td:has-text("Catless downpipe")');
  await p.click('[data-act=pull-arm]'); await p.waitForSelector('#pull-box :text("ARMED")');
  await p.evaluate(() => { window.__thr = 'FF'; }); await p.waitForSelector('#pull-box :text("RECORDING")');
  await p.waitForTimeout(1800); await p.evaluate(() => { window.__thr = '20'; });
  await toast(/Pull saved/);
  await p.waitForSelector('#tune-body td:has-text("112")'); // 120 g/s peak airflow -> ~112 kW estimate
  await p.click('[data-act=pull-dyno]'); await p.waitForSelector('#pull-dyno-out :text("virtual dyno")');
  if (await p.locator('#pull-dyno-out :text("Possible knock")').count()) problems.push('false knock warning on a clean pull');
  if (await p.locator('#pull-dyno-out td:text-is("1750")').count()) problems.push('lift-off sample leaked into the dyno curve');
  if (!(await p.locator('#pull-dyno-out :text("112 kW @ 6000 rpm")').count())) problems.push('dyno peak not at 112 kW @ 6000 rpm: ' + await p.locator('#pull-dyno-out b').first().textContent());
  await p.locator('#pull-dyno-out').screenshot({ path: '/tmp/e2e-dyno.png' });

  // self-update: Settings shows the app version, and a newer deployed build triggers the reload bar
  await p.click('[data-nav=settings]'); await p.waitForSelector('#ver-box');
  await p.waitForFunction(() => /v\d+\.\d+/.test(document.querySelector('#ver-box').textContent));
  await p.evaluate(() => window.__noteVersion('99.0.0'));
  await p.waitForSelector('#update-bar.show');
  if (!(await p.locator('#update-bar :text("new version")').count())) problems.push('update bar text missing');
  await p.click('[data-act=app-reload-dismiss]');
  await p.waitForSelector('#update-bar:not(.show)');

  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'SCANNER E2E OK');
  await b.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('SCANNER E2E FAIL', e.message); process.exit(1); });
