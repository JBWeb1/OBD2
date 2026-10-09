const test = require('node:test');
const assert = require('node:assert/strict');

// Fake ELM327 that answers like a CAN car.
function fakeAdapter(script) {
  let chunks = []; let resolveRead = null;
  const push = (s) => { const v = new TextEncoder().encode(s); if (resolveRead) { const r = resolveRead; resolveRead = null; r({ value: v, done: false }); } else chunks.push(v); };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serial: { requestPort: async () => ({
    open: async () => {},
    close: async () => {},
    writable: { getWriter: () => ({ write: async (b) => { const cmd = new TextDecoder().decode(b).trim(); push((script[cmd] ?? 'NO DATA') + '\r\r>'); }, releaseLock() {} }) },
    readable: { getReader: () => ({
      read: () => chunks.length ? Promise.resolve({ value: chunks.shift(), done: false }) : new Promise((r) => { resolveRead = r; }),
      cancel: async () => { if (resolveRead) resolveRead({ done: true }); }, releaseLock() {},
    }) },
  }) } } });
}
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
