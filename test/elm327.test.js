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
