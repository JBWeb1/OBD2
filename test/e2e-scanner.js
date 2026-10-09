// Browser test of the real scanner UI against a simulated ELM327 on Web Serial (CAN car).
// Covers: connect, supported-sensor picker, multi-PID live scan, adapter dropout + auto-reconnect,
// stop & save, fault codes, Mode 06.   Run: node test/dev-server.js & node test/e2e-scanner.js
const { chromium } = require(process.env.PW || 'playwright');

// Runs inside the page before the app loads.
function fakeSerial() {
  const VALUES = { '04': '66', '05': '52', '0C': '1AF8', '0D': '3C', '0F': '41', '11': '80', '2F': '80', '42': '3778', '46': '3C' };
  const FIXED = {
    ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK', ATDP: 'AUTO, ISO 15765-4 (CAN 11/500)',
    '0100': '4100981A8001', '0120': '412000020001', '0140': '414044000000',
    '03': '4302030104 20'.replace(/ /g, ''), '07': '4700', '0A': '4A00',
    '0600': '460000000001', '0620': '462080000000', '0621': '013\n0:46218024007800\n1:0000C821810B03\n2:8400640320',
  };
  const log = (window.__sent = []);
  let reader = null; let open = false;
  const reply = (cmd) => {
    if (FIXED[cmd]) return FIXED[cmd];
    if (/^01([0-9A-F]{2})+$/.test(cmd)) {
      const pids = cmd.slice(2).match(/../g);
      const parts = pids.filter((p) => VALUES[p]).map((p) => p + VALUES[p]);
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
  await p.waitForSelector('#pid-pick :text("9 sensors this car supports")');
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

  console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'SCANNER E2E OK');
  await b.close(); process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('SCANNER E2E FAIL', e.message); process.exit(1); });
