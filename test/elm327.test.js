const test = require('node:test');
const assert = require('node:assert/strict');

// Fake ELM327 that answers like a CAN car.
// Script values can be strings or functions (cmd => reply). Returns controls to inspect and break the link.
function fakeAdapter(script) {
  let chunks = []; let resolveRead = null;
  const ctl = { sent: [], opens: 0, unplugged: false };
  const push = (s) => { const v = new TextEncoder().encode(s); if (resolveRead) { const r = resolveRead; resolveRead = null; r({ value: v, done: false }); } else chunks.push(v); };
  const port = {
    getInfo: () => ({ usbVendorId: 0x0403, usbProductId: 0x6001 }),
    open: async () => { if (ctl.unplugged) throw new Error('NetworkError: device not found'); ctl.opens++; chunks = []; },
    close: async () => {},
    get writable() { return { getWriter: () => ({ write: async (b) => {
      const cmd = new TextDecoder().decode(b).trim(); ctl.sent.push(cmd);
      const r = typeof script[cmd] === 'function' ? script[cmd](cmd) : script[cmd];
      if (r !== null) push((r ?? 'NO DATA') + '\r\r>');
    }, releaseLock() {} }) }; },
    get readable() { return { getReader: () => ({
      read: () => chunks.length ? Promise.resolve({ value: chunks.shift(), done: false }) : new Promise((r) => { resolveRead = r; }),
      cancel: async () => { if (resolveRead) { const r = resolveRead; resolveRead = null; r({ done: true }); } }, releaseLock() {},
    }) }; },
  };
  ctl.drop = () => { if (resolveRead) { const r = resolveRead; resolveRead = null; r({ done: true }); } }; // cable pulled
  ctl.push = push;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort: async () => port, getPorts: async () => (ctl.unplugged ? [] : [port]) } } });
  return ctl;
}
const INIT = { ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK', '0100': '4100BE1FA813', ATDP: 'AUTO, ISO 15765-4 (CAN 11/500)' };
const ELM327 = require('../public/elm327.js');

test('decodes standard PIDs from CAN responses, DTCs and VIN', async () => {
  fakeAdapter({
    ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK',
    '0100': 'SEARCHING...\n4100BE1FA813', ATDP: 'AUTO, ISO 15765-4 (CAN 11/500)',
    '010C': '410C1AF8',   // (256*0x1A+0xF8)/4 = 1726
    '0105': '410552',     // 0x52-40 = 42
    '0142': '41423A98',   // 15000/1000 = 15
    '03': '430201040301', // 2 DTCs on CAN: P0104 + P0301
    '07': 'NO DATA',
    '04': '44',
    '0101': '4101820765 04'.replace(/ /g, ''),
    '020200': '4202000301',
    '020C00': '420C001AF8',
    '020500': '42050052',
    '0A': '4A0001330000',
    '0902': '014\n0: 49 02 01 57 56 57\n1: 5A 5A 5A 36 52 5A\n2: 48 59 31 32 33 34 35 36',
  });
  const e = new ELM327();
  await e.connect();
  assert.equal(e.isCan, true);
  assert.ok(e.supported.has('01') && e.supported.has('03'));
  assert.equal(await e.readPid('0C'), 1726);
  assert.equal(await e.readPid('05'), 42);
  assert.equal(await e.readPid('42'), 15);
  assert.equal(await e.readPid('0D'), null, 'NO DATA gives null, never a made-up value');
  assert.deepEqual(await e.readStoredDtcs(), ['P0104', 'P0301']);
  assert.deepEqual(await e.readPendingDtcs(), []);
  assert.equal(await e.clearDtcs(), true);
  assert.equal(await e.readVin(), 'WVWZZZ6RZHY123456');
  const rd = await e.readReadiness();
  assert.equal(rd.mil, true); assert.equal(rd.dtcCount, 2); assert.equal(rd.type, 'spark');
  assert.ok(rd.monitors.find((m) => m.name === 'Misfire').ready);
  assert.ok(rd.monitors.find((m) => m.name === 'Catalyst'), 'catalyst monitor supported');
  const ff = await e.readFreezeFrame();
  assert.equal(ff.dtc, 'P0301'); assert.equal(ff.values['0C'], 1726); assert.equal(ff.values['05'], 42);
  assert.deepEqual(await e.readPermanentDtcs(), ['P0133']);
  await e.disconnect();
});

test('DTC byte decoding covers all four systems', () => {
  assert.equal(ELM327.decodeDtcBytes('0420'), 'P0420');
  assert.equal(ELM327.decodeDtcBytes('4123'), 'C0123');
  assert.equal(ELM327.decodeDtcBytes('8100'), 'B0100');
  assert.equal(ELM327.decodeDtcBytes('C100'), 'U0100');
  assert.equal(ELM327.decodeDtcBytes('0000'), null);
});

test('supported PIDs beyond 0x20 are discovered (0120/0140) and merged across ECUs', async () => {
  fakeAdapter({
    ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK',
    // engine ECU: 01,03-07,0C,0D,0F,10,20 ; transmission ECU: 0B
    '0100': '4100BE1FA013\n4100002000 00',
    '0120': '41208007B011', // 21, 2E, 2F, 30, 31, 33, 34, 3C, 40 (40 = next range exists)
    '0140': '414040000000', // 42 (battery voltage)
    ATDP: 'ISO 15765-4 (CAN 11/500)',
  });
  const e = new ELM327();
  await e.connect();
  for (const pid of ['01', '0C', '0D', '0B', '20', '21', '2F', '40', '42']) assert.ok(e.supported.has(pid), `PID ${pid} supported`);
  assert.ok(!e.supported.has('60'), '0160 not requested when PID 40 says the range ends');
  await e.disconnect();
});

test('multi-frame CAN DTC reply (more than two codes) is fully decoded', async () => {
  fakeAdapter({
    ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK',
    '0100': '4100BE1FA810', ATDP: 'ISO 15765-4 (CAN 11/500)',
    // 5 codes: 43 05 | 0104 0301 0420 0171 C100 -> 12 bytes = 0x00C
    '03': '00C\n0:43050104030104\n1:200171C1000000',
    '04': 'NO DATA',
  });
  const e = new ELM327();
  await e.connect();
  assert.deepEqual(await e.readStoredDtcs(), ['P0104', 'P0301', 'P0420', 'P0171', 'U0100']);
  assert.equal(await e.clearDtcs(), false, 'NO DATA is not a confirmed clear');
  await e.disconnect();
});

test('K-line (ISO 9141) DTC replies: one line per frame, zero padding ignored', async () => {
  fakeAdapter({
    ATZ: 'ELM327 v1.5', ATE0: 'OK', ATL0: 'OK', ATS0: 'OK', ATH0: 'OK', ATAT1: 'OK', ATSP0: 'OK',
    '0100': 'BUS INIT: ...OK\n4100BE1FA810', ATDP: 'ISO 9141-2',
    '03': '43010403010420\n43017100000000',
    '0902': '490201000000 57\n49020256575A5A\n4902035A36525A\n49020448593132\n49020533343536'.replace(/ /g, ''),
  });
  const e = new ELM327();
  await e.connect();
  assert.equal(e.isCan, false);
  assert.deepEqual(await e.readStoredDtcs(), ['P0104', 'P0301', 'P0420', 'P0171']);
  assert.equal(await e.readVin(), 'WVWZZZ6RZHY123456');
  await e.disconnect();
});

test('message splitter joins numbered CAN frames, including hex frame indexes past 9', () => {
  const frames = ['0:490201575657'].concat(Array.from({ length: 11 }, (_, i) => `${(i + 1).toString(16).toUpperCase()}:41414141414141`));
  const out = ELM327.messages('050\n' + frames.join('\n'));
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 0x50 * 2);
});

test('multi-PID requests on CAN: one request for up to 6 PIDs, split back out by reply length', async () => {
  const ctl = fakeAdapter({
    ...INIT,
    // 0C=1726 rpm, 0D=60 km/h, 05=42 C, 42=14.2 V, 11=50%, 0F=25 C  |  then 2F alone
    '010C0D05421110': '010\n0:410C1AF80D3C05\n1:52423778118010\n2:003F',
    '010F2F': '410F41 2F80'.replace(/ /g, ''),
  });
  const e = new ELM327(); await e.connect();
  const v = await e.readPids(['0C', '0D', '05', '42', '11', '10', '0F', '2F']);
  assert.equal(v['0C'], 1726); assert.equal(v['0D'], 60); assert.equal(v['05'], 42);
  assert.equal(v['42'], 14.2); assert.equal(Math.round(v['11']), 50); assert.equal(v['10'], 0.63);
  assert.equal(v['0F'], 25); assert.equal(Math.round(v['2F']), 50);
  assert.equal(ctl.sent.filter((c) => c.startsWith('01') && c.length > 4).length, 2, 'two requests for eight PIDs');
  await e.disconnect();
});

test('multi-PID falls back to one PID per request when the car does not answer that way', async () => {
  const ctl = fakeAdapter({ ...INIT, '010C0D': 'NO DATA', '010C': '410C1AF8', '010D': '410D3C' });
  const e = new ELM327(); await e.connect();
  assert.deepEqual(await e.readPids(['0C', '0D']), { '0C': 1726, '0D': 60 });
  assert.equal(e.multiPid, false);
  await e.readPids(['0C', '0D']);
  assert.equal(ctl.sent.filter((c) => c === '010C0D').length, 1, 'does not keep retrying multi-PID');
  await e.disconnect();
});

test('Mode 06: supported monitors, scaled results, pass/fail on raw values', async () => {
  fakeAdapter({
    ...INIT,
    '0600': '460000000001',                          // no MIDs 01-1F, but the 21-40 range exists
    '0620': '462080000000',                          // MID 21 (catalyst bank 1) only, no further range
    // MID 21: TID 80, UASID 24 (counts): 120 in [0, 200] -> pass ; MID 21 TID 81 UASID 0B (V): 0.9 V in [0.1, 0.8] -> fail
    '0621': '013\n0:46218024007800\n1:0000C821810B03\n2:8400640320',
    '0601': 'NO DATA',
  });
  const e = new ELM327(); await e.connect();
  const r = await e.readMonitorTests();
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { mid: 0x21, monitor: 'Catalyst bank 1', tid: 0x80, uas: 0x24, value: 120, min: 0, max: 200, unit: 'counts', pass: true });
  assert.equal(r[1].unit, 'V'); assert.equal(r[1].value, 0.9); assert.equal(r[1].max, 0.8); assert.equal(r[1].pass, false);
  await e.disconnect();
});

test('Mode 06 signed scaling and monitor names', () => {
  assert.equal(ELM327.monitorName(0x01), 'O2 sensor B1S1');
  assert.equal(ELM327.monitorName(0x06), 'O2 sensor B2S2');
  assert.equal(ELM327.monitorName(0xA4), 'Misfire cylinder 3');
  assert.equal(ELM327.monitorName(0xEE), 'Monitor EE');
});

test('reconnect after the adapter drops out, without asking for the port again', async () => {
  const ctl = fakeAdapter({ ...INIT, '010C': '410C1AF8' });
  const e = new ELM327(); await e.connect();
  ctl.drop(); await new Promise((r) => setTimeout(r, 10));
  assert.equal(e.connected, false);
  await assert.rejects(() => e.readPid('0C'), /disconnected|Not connected/);
  ctl.unplugged = true;
  assert.equal(await e.reconnect(), false, 'still unplugged');
  ctl.unplugged = false;
  assert.equal(await e.reconnect(), true);
  assert.equal(ctl.opens, 2);
  assert.equal(await e.readPid('0C'), 1726);
  await e.disconnect();
});

test('a late reply after a timeout is not taken as the answer to the next command', async () => {
  let late = null;
  const ctl = fakeAdapter({ ...INIT, '010D': () => { late = setTimeout(() => ctl.push('410D3C\r\r>'), 60); return null; }, '010C': '410C1AF8' });
  const e = new ELM327(); await e.connect();
  const t0 = e.send; e.send = (cmd, timeout) => t0.call(e, cmd, cmd === '010D' ? 30 : timeout);
  assert.equal(await e.readPid('0D'), null);
  assert.equal(await e.readPid('0C'), 1726);
  clearTimeout(late); await e.disconnect();
});
