/* ELM327 driver over the Web Serial API (Chrome / Edge, secure context or localhost).
 * Only standard SAE J1979 Mode 01 PIDs are decoded. Nothing here fabricates readings:
 * if the adapter or ECU does not answer, the value is null. */
(function (root) {
  'use strict';

  // Decoders for standard Mode 01 PIDs (SAE J1979). `b` = data bytes after the "41 xx" header.
  const pct = (b) => b[0] * 100 / 255;
  const trim = (b) => (b[0] - 128) * 100 / 128;
  const word = (b) => 256 * b[0] + b[1];
  const DECODE = {
    '04': pct,
    '05': (b) => b[0] - 40,
    '06': trim, '07': trim, '08': trim, '09': trim,
    '0A': (b) => b[0] * 3,
    '0B': (b) => b[0],
    '0C': (b) => (256 * b[0] + b[1]) / 4,
    '0D': (b) => b[0],
    '0E': (b) => b[0] / 2 - 64,
    '0F': (b) => b[0] - 40,
    '10': (b) => (256 * b[0] + b[1]) / 100,
    '11': (b) => b[0] * 100 / 255,
    '14': (b) => b[0] / 200, '15': (b) => b[0] / 200, '18': (b) => b[0] / 200, '19': (b) => b[0] / 200, // O2 voltage (byte B = trim, ignored)
    '1F': word,
    '21': word,
    '22': (b) => word(b) * 0.079,
    '23': (b) => word(b) * 10,
    '2C': pct,
    '2D': (b) => b[0] * 100 / 128 - 100,
    '2E': pct,
    '2F': pct,
    '30': (b) => b[0],
    '31': word,
    '33': (b) => b[0],
    '3C': (b) => word(b) / 10 - 40, '3E': (b) => word(b) / 10 - 40,
    '42': (b) => word(b) / 1000,
    '43': (b) => word(b) * 100 / 255,
    '44': (b) => word(b) * 2 / 65536,
    '45': pct,
    '46': (b) => b[0] - 40,
    '47': pct, '49': pct, '4C': pct,
    '4D': word,
    '52': pct,
    '59': (b) => word(b) * 10,
    '5A': pct,
    '5C': (b) => b[0] - 40,
    '5E': (b) => word(b) / 20,
    '61': (b) => b[0] - 125, '62': (b) => b[0] - 125,
    '63': word,
  };
  // Reply length in data bytes. Needed to split a multi-PID reply ("41 0C xx xx 0D xx ...").
  const BYTES = {
    '04': 1, '05': 1, '06': 1, '07': 1, '08': 1, '09': 1, '0A': 1, '0B': 1, '0C': 2, '0D': 1, '0E': 1, '0F': 1, '10': 2, '11': 1,
    '14': 2, '15': 2, '18': 2, '19': 2, '1F': 2, '21': 2, '22': 2, '23': 2, '2C': 1, '2D': 1, '2E': 1, '2F': 1, '30': 1, '31': 2, '33': 1,
    '3C': 2, '3E': 2, '42': 2, '43': 2, '44': 2, '45': 1, '46': 1, '47': 1, '49': 1, '4C': 1, '4D': 2, '52': 1, '59': 2, '5A': 1,
    '5C': 1, '5E': 2, '61': 1, '62': 1, '63': 2,
  };

  // Mode 06 unit-and-scaling IDs (SAE J1979 appendix E): [multiplier, unit, offset]. 0x80+ are signed.
  const UAS = {
    0x01: [1, ''], 0x02: [0.1, ''], 0x03: [0.01, ''], 0x04: [0.001, ''], 0x05: [0.0000305, ''], 0x06: [0.000305, ''],
    0x07: [0.25, 'rpm'], 0x08: [0.01, 'km/h'], 0x09: [1, 'km/h'], 0x0A: [0.122, 'mV'], 0x0B: [0.001, 'V'], 0x0C: [0.01, 'V'],
    0x0D: [0.00390625, 'mA'], 0x0E: [0.001, 'A'], 0x0F: [0.01, 'A'], 0x10: [1, 'ms'], 0x11: [100, 'ms'], 0x12: [1, 's'],
    0x13: [1, 'mΩ'], 0x14: [1, 'Ω'], 0x15: [1, 'kΩ'], 0x16: [0.1, '°C', -40], 0x17: [0.01, 'kPa'], 0x18: [0.0117, 'kPa'],
    0x19: [0.079, 'kPa'], 0x1A: [1, 'kPa'], 0x1B: [10, 'kPa'], 0x1C: [0.01, '°'], 0x1D: [0.5, '°'], 0x1E: [0.0000305, 'λ'],
    0x1F: [0.05, 'A/F'], 0x20: [0.0039062, ''], 0x21: [1, 'mHz'], 0x22: [1, 'Hz'], 0x23: [1, 'kHz'], 0x24: [1, 'counts'],
    0x25: [1, 'km'], 0x26: [0.1, 'mV/ms'], 0x27: [0.01, 'g/s'], 0x28: [1, 'g/s'], 0x29: [0.25, 'Pa/s'], 0x2A: [0.001, 'kg/h'],
    0x2B: [1, 'switches'], 0x2C: [0.01, 'g/cyl'], 0x2D: [0.01, 'mg/stroke'], 0x2F: [0.01, '%'], 0x30: [0.001526, '%'],
    0x31: [0.001, 'L'], 0x34: [1, 'min'], 0x35: [10, 'ms'], 0x36: [0.01, 'g'], 0x37: [0.1, 'g'], 0x38: [1, 'g'],
    0x81: [1, ''], 0x82: [0.1, ''], 0x83: [0.01, ''], 0x84: [0.001, ''], 0x85: [0.0000305, ''], 0x86: [0.000305, ''],
    0x8A: [0.122, 'mV'], 0x8B: [0.001, 'V'], 0x8C: [0.01, 'V'], 0x8D: [0.00390625, 'mA'], 0x8E: [0.001, 'A'], 0x90: [1, 'ms'],
    0x96: [0.1, '°C'], 0x9C: [0.01, '°'], 0x9D: [0.5, '°'], 0xA8: [1, 'g/s'], 0xA9: [0.25, 'Pa/s'], 0xAF: [0.01, '%'], 0xB0: [0.003052, '%'],
    0xFC: [0.01, 'kPa'], 0xFD: [0.001, 'kPa'], 0xFE: [0.25, 'Pa'],
  };

  // On-board monitor IDs (OBDMID).
  function monitorName(mid) {
    const sensor = (n) => `B${Math.floor(n / 4) + 1}S${(n % 4) + 1}`;
    if (mid >= 0x01 && mid <= 0x10) return `O2 sensor ${sensor(mid - 1)}`;
    if (mid >= 0x21 && mid <= 0x24) return `Catalyst bank ${mid - 0x20}`;
    if (mid >= 0x31 && mid <= 0x34) return `EGR / VVT bank ${mid - 0x30}`;
    const evap = { 0x39: 'EVAP leak (cap off / 0.150")', 0x3A: 'EVAP leak 0.090"', 0x3B: 'EVAP leak 0.040"', 0x3C: 'EVAP leak 0.020"', 0x3D: 'EVAP purge flow' };
    if (evap[mid]) return evap[mid];
    if (mid >= 0x41 && mid <= 0x50) return `O2 sensor heater ${sensor(mid - 0x41)}`;
    if (mid >= 0x61 && mid <= 0x64) return `Heated catalyst bank ${mid - 0x60}`;
    if (mid >= 0x71 && mid <= 0x74) return `Secondary air ${mid - 0x70}`;
    if (mid >= 0x81 && mid <= 0x84) return `Fuel system bank ${mid - 0x80}`;
    if (mid >= 0x85 && mid <= 0x88) return `Boost pressure bank ${mid - 0x84}`;
    if (mid === 0x90 || mid === 0x91) return `NOx adsorber bank ${mid - 0x8F}`;
    if (mid === 0x98 || mid === 0x99) return `NOx catalyst bank ${mid - 0x97}`;
    if (mid === 0xA1) return 'Misfire (general)';
    if (mid >= 0xA2 && mid <= 0xAD) return `Misfire cylinder ${mid - 0xA1}`;
    if (mid === 0xB0 || mid === 0xB1) return `PM filter bank ${mid - 0xAF}`;
    return `Monitor ${mid.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  const ERRORS = ['NO DATA', 'UNABLE TO CONNECT', 'BUS INIT', 'CAN ERROR', 'BUFFER FULL', 'BUS BUSY', 'FB ERROR', 'DATA ERROR', 'STOPPED', 'ERROR', '?'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Splits an adapter reply into complete messages (hex strings, no spaces). CAN replies longer than one frame arrive as
  // a length line ("00A") followed by numbered frames ("0:...", "1:...", ... "F:", "0:" ...); those are joined back into
  // one message. Every other line (single frames, K-line replies, one line per ECU) is its own message.
  function messages(text) {
    const out = []; let cur = null;
    for (const raw of String(text).split('\n')) {
      const line = raw.trim().toUpperCase();
      if (/^[0-9A-F]{3}$/.test(line)) { cur = { hex: '', len: parseInt(line, 16) }; out.push(cur); continue; }
      const frame = /^[0-9A-F]:(.*)$/.exec(line);
      if (frame && cur) { cur.hex += frame[1].replace(/[^0-9A-F]/g, ''); continue; }
      const hex = (frame ? frame[1] : line).replace(/[^0-9A-F]/g, '');
      if (hex) { cur = null; out.push({ hex }); }
    }
    return out.map((m) => (m.len ? m.hex.slice(0, m.len * 2) : m.hex));
  }

  function decodeDtcBytes(hex2) {
    const letters = ['P', 'C', 'B', 'U'];
    const a = parseInt(hex2.slice(0, 2), 16), b = hex2.slice(2, 4);
    if (a === 0 && b === '00') return null;
    return letters[a >> 6] + ((a >> 4) & 3).toString(16).toUpperCase() + (a & 15).toString(16).toUpperCase() + b.toUpperCase();
  }

  class ELM327 {
    constructor({ onLog } = {}) {
      this.port = null; this.writer = null; this.reader = null;
      this.buffer = ''; this.busy = Promise.resolve();
      this.onLog = onLog || (() => {});
      this.protocol = null; this.isCan = false; this.connected = false; this.supported = new Set();
      this.options = null; this.portInfo = null; this.multiPid = true;
    }

    static isSupported() { return 'serial' in navigator; }

    async connect({ baudRate = 38400, protocolCmd = 'ATSP0' } = {}) {
      if (!ELM327.isSupported()) throw new Error('Web Serial is not available. Use Chrome or Edge on a computer.');
      const port = await navigator.serial.requestPort();
      this.options = { baudRate, protocolCmd };
      return this._open(port);
    }

    // Reopens the adapter after a dropout (loose plug, adapter reset, USB glitch) without asking the user to
    // pick the port again: Chrome remembers ports the user already granted. Returns false if it isn't back.
    async reconnect() {
      if (!this.options) return false;
      await this.disconnect();
      const ports = navigator.serial.getPorts ? await navigator.serial.getPorts() : [];
      const same = (p) => {
        const i = p.getInfo ? p.getInfo() : {};
        return !this.portInfo || (i.usbVendorId === this.portInfo.usbVendorId && i.usbProductId === this.portInfo.usbProductId);
      };
      const port = ports.find(same) || this._lastPort;
      if (!port) return false;
      try { await this._open(port); return true; } catch (_) { await this.disconnect(); return false; }
    }

    async _open(port) {
      const { baudRate, protocolCmd } = this.options;
      this.port = port; this._lastPort = port;
      this.portInfo = port.getInfo ? port.getInfo() : null;
      await this.port.open({ baudRate });
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this._pump();
      this.connected = true; this.multiPid = true;

      await this.send('ATZ', 3000);
      await this.send('ATE0'); await this.send('ATL0'); await this.send('ATS0');
      await this.send('ATH0'); await this.send('ATAT1');
      await this.send(protocolCmd);
      // First real query triggers protocol search; allow a long timeout.
      const r = await this.send('0100', 15000);
      if (!/4100/.test(r.replace(/\s/g, ''))) {
        throw new Error(this._explain(r) || 'The adapter is connected but the car did not answer. Turn the ignition on and check the protocol.');
      }
      this.supported = await this._readSupported(r);
      this.protocol = (await this.send('ATDP')).replace(/^AUTO,\s*/i, '').trim();
      this.isCan = /CAN/i.test(this.protocol);
      return { protocol: this.protocol };
    }

    async disconnect() {
      this.connected = false;
      try { await this.reader?.cancel(); } catch (_) { /* ignore */ }
      try { this.reader?.releaseLock(); } catch (_) { /* ignore */ }
      try { this.writer?.releaseLock(); } catch (_) { /* ignore */ }
      try { await this.port?.close(); } catch (_) { /* ignore */ }
      this.port = this.writer = this.reader = null;
    }

    async _pump() {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this.buffer += dec.decode(value);
        }
      } catch (_) { /* port closed */ }
      this.connected = false;
    }

    // Serialised: one command at a time. Resolves with the raw response (without echo/prompt).
    send(cmd, timeout = 3000) {
      const run = async () => {
        if (!this.writer) throw new Error('Not connected');
        this.buffer = '';
        this.onLog('>', cmd);
        await this.writer.write(new TextEncoder().encode(cmd + '\r'));
        const start = Date.now();
        while (!this.buffer.includes('>')) {
          if (Date.now() - start > timeout) {
            this.onLog('!', 'timeout');
            // Let a late reply finish so it isn't mistaken for the answer to the next command.
            for (let i = 0; i < 20 && !this.buffer.includes('>') && this.connected; i++) await sleep(25);
            return '';
          }
          if (!this.connected) throw new Error('Adapter disconnected');
          await sleep(15);
        }
        const text = this.buffer.split('>')[0].replace(/\r/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean)
          .filter((l) => !/^SEARCHING/i.test(l) && l.toUpperCase() !== cmd.toUpperCase()).join('\n');
        this.onLog('<', text || '(empty)');
        return text;
      };
      const p = this.busy.then(run, run);
      this.busy = p.catch(() => {});
      return p;
    }

    _explain(text) {
      const t = text.toUpperCase();
      if (t.includes('UNABLE TO CONNECT')) return 'Unable to connect to the ECU. Check ignition is on and try another protocol.';
      if (t.includes('NO DATA')) return 'The car did not respond (NO DATA).';
      if (t.includes('CAN ERROR') || t.includes('BUS')) return 'Bus error. Check the adapter and protocol.';
      return '';
    }

    // Bitmask reply to 01 00 / 01 20 / 01 40 ... Each answer covers the next 32 PIDs; with several ECUs the masks are merged.
    _parseSupported(text, base = 0, set = new Set()) {
      const head = '41' + base.toString(16).toUpperCase().padStart(2, '0');
      for (const hex of messages(text)) {
        if (!hex.startsWith(head) || hex.length < 12) continue;
        const bytes = hex.slice(4, 12);
        for (let n = 0; n < 32; n++) {
          const byte = parseInt(bytes.substr(Math.floor(n / 8) * 2, 2), 16);
          if ((byte >> (7 - (n % 8))) & 1) set.add((base + n + 1).toString(16).toUpperCase().padStart(2, '0'));
        }
      }
      return set;
    }

    // 01 00 only lists PIDs 01-20. PID 20/40/60 being "supported" means the next range exists, so ask for it too —
    // otherwise PIDs such as 2F (fuel level), 42 (battery voltage) and 5C (oil temperature) would never be polled.
    async _readSupported(first) {
      const set = this._parseSupported(first, 0);
      for (let base = 0x20; base <= 0xA0 && set.has(base.toString(16).toUpperCase().padStart(2, '0')); base += 0x20) {
        const cmd = '01' + base.toString(16).toUpperCase().padStart(2, '0');
        this._parseSupported(await this.send(cmd, 4000), base, set);
      }
      return set;
    }

    // Returns the decoded value of a standard Mode 01 PID, or null if unsupported / no answer.
    async readPid(pid) {
      const p = pid.toUpperCase();
      const decode = DECODE[p];
      if (!decode) return null;
      const text = await this.send('01' + p);
      for (const hex of messages(text)) {
        if (hex.startsWith('41' + p)) {
          const data = hex.slice(4).match(/.{2}/g)?.map((h) => parseInt(h, 16)) || [];
          if (data.length < (BYTES[p] || 1)) return null;
          return decode(data);
        }
      }
      return null;
    }

    // Reads several Mode 01 PIDs. On CAN, up to 6 PIDs go in one request ("010C0D0511..."), which is several times
    // faster than one at a time. Falls back to single requests if the car or adapter doesn't support that.
    // Returns { pid: value|null }.
    async readPids(pids) {
      const list = pids.map((p) => p.toUpperCase()).filter((p) => DECODE[p]);
      const out = {};
      if (!this.isCan || !this.multiPid || list.length < 2) {
        for (const p of list) out[p] = await this.readPid(p);
        return out;
      }
      for (let i = 0; i < list.length; i += 6) {
        const chunk = list.slice(i, i + 6);
        const got = this._parseMulti(await this.send('01' + chunk.join('')), chunk);
        if (chunk.every((p) => got[p] === undefined)) { // nothing usable: this ECU/adapter doesn't do multi-PID
          this.multiPid = false;
          for (const p of list.slice(i)) out[p] = await this.readPid(p);
          return out;
        }
        for (const p of chunk) out[p] = got[p] === undefined ? null : got[p];
      }
      return out;
    }

    _parseMulti(text, wanted) {
      const out = {};
      for (const hex of messages(text)) {
        if (!hex.startsWith('41')) continue;
        let i = 2;
        while (i + 2 <= hex.length) {
          const pid = hex.slice(i, i + 2); const n = BYTES[pid];
          if (!n || !wanted.includes(pid)) break; // unknown PID: can't know its length, stop parsing this message
          const data = (hex.slice(i + 2, i + 2 + n * 2).match(/.{2}/g) || []).map((h) => parseInt(h, 16));
          if (data.length < n) break;
          if (out[pid] === undefined) out[pid] = DECODE[pid](data);
          i += 2 + n * 2;
        }
      }
      return out;
    }

    // Mode 06: results of the car's own on-board monitor tests (catalyst, O2 sensors, EGR, EVAP, misfire...).
    // CAN only (2008+); older protocols use a different, manufacturer-defined layout. Returns null if unavailable.
    async readMonitorTests() {
      if (!this.isCan) return null;
      const mids = [];
      for (let base = 0; base <= 0xE0; base += 0x20) {
        const head = '46' + base.toString(16).toUpperCase().padStart(2, '0');
        const msg = messages(await this.send('06' + head.slice(2), 4000)).find((m) => m.startsWith(head) && m.length >= 12);
        if (!msg) break;
        const mask = parseInt(msg.slice(4, 12), 16) >>> 0;
        for (let n = 0; n < 31; n++) if ((mask >>> (31 - n)) & 1) mids.push(base + n + 1);
        if (!(mask & 1)) break; // next range not supported
      }
      if (!mids.length) return null;
      const results = [];
      for (const mid of mids) {
        const m = mid.toString(16).toUpperCase().padStart(2, '0');
        for (const hex of messages(await this.send('06' + m, 4000))) {
          if (!hex.startsWith('46' + m)) continue;
          for (let i = 2; i + 18 <= hex.length; i += 18) { // MID TID UASID value(2) min(2) max(2)
            const rec = hex.slice(i, i + 18);
            if (rec.slice(0, 2) !== m) break;
            const tid = parseInt(rec.slice(2, 4), 16), uas = parseInt(rec.slice(4, 6), 16);
            const signed = uas >= 0x80;
            const num = (h) => { const v = parseInt(h, 16); return signed && v > 0x7FFF ? v - 0x10000 : v; };
            const raw = { value: num(rec.slice(6, 10)), min: num(rec.slice(10, 14)), max: num(rec.slice(14, 18)) };
            const sc = UAS[uas];
            const scale = (v) => (sc ? +(v * sc[0] + (sc[2] || 0)).toPrecision(6) : v);
            results.push({
              mid, monitor: monitorName(mid), tid, uas,
              value: scale(raw.value), min: scale(raw.min), max: scale(raw.max), unit: sc ? sc[1] : '(raw)',
              pass: raw.value >= raw.min && raw.value <= raw.max, // compared unscaled, so it is right even for unknown units
            });
          }
        }
      }
      return results;
    }

    async _dtcs(cmd, respHeader) {
      const text = await this.send(cmd, 6000);
      if (/NO DATA/i.test(text) && !new RegExp(respHeader, 'i').test(text.replace(/\s/g, ''))) return [];
      const codes = [];
      for (let hex of messages(text)) {
        if (!hex.startsWith(respHeader)) continue;
        hex = hex.slice(respHeader.length);
        if (this.isCan) { // CAN: a count byte follows the header; when it is set, anything past count codes is padding
          const count = parseInt(hex.slice(0, 2), 16) || 0;
          hex = count ? hex.slice(2, 2 + count * 4) : hex.slice(2);
        }
        for (let i = 0; i + 4 <= hex.length; i += 4) {
          const c = decodeDtcBytes(hex.slice(i, i + 4));
          if (c) codes.push(c);
        }
      }
      return [...new Set(codes)];
    }

    readStoredDtcs() { return this._dtcs('03', '43'); }
    readPendingDtcs() { return this._dtcs('07', '47'); }

    async clearDtcs() {
      const t = await this.send('04', 6000);
      return messages(t).some((hex) => hex.startsWith('44'));
    }

    readPermanentDtcs() { return this._dtcs('0A', '4A'); }

    // Mode 01 PID 01: MIL state, stored-code count and emissions readiness monitors.
    async readReadiness() {
      const text = await this.send('0101', 6000);
      for (const hex of messages(text)) {
        if (!hex.startsWith('4101') || hex.length < 12) continue;
        const [A, B, C, D] = hex.slice(4, 12).match(/.{2}/g).map((h) => parseInt(h, 16));
        const diesel = !!(B & 0x08);
        const monitors = [];
        [['Misfire', 0], ['Fuel system', 1], ['Components', 2]].forEach(([name, bit]) => {
          if ((B >> bit) & 1) monitors.push({ name, ready: !((B >> (bit + 4)) & 1) });
        });
        const names = diesel
          ? { 0: 'NMHC catalyst', 1: 'NOx / SCR', 3: 'Boost pressure', 5: 'Exhaust gas sensor', 6: 'PM filter', 7: 'EGR / VVT' }
          : { 0: 'Catalyst', 1: 'Heated catalyst', 2: 'Evaporative system', 3: 'Secondary air', 4: 'A/C refrigerant', 5: 'Oxygen sensor', 6: 'Oxygen sensor heater', 7: 'EGR system' };
        for (const [bit, name] of Object.entries(names)) {
          if ((C >> bit) & 1) monitors.push({ name, ready: !((D >> bit) & 1) });
        }
        return { mil: !!(A & 0x80), dtcCount: A & 0x7f, type: diesel ? 'compression' : 'spark', monitors };
      }
      return null;
    }

    // Mode 02 freeze frame (frame 0): the code that triggered it plus key sensor values at that moment.
    async readFreezeFrame() {
      const out = { dtc: null, values: {} };
      const t = await this.send('020200', 4000);
      for (const hex of messages(t)) {
        if (hex.startsWith('420200') && !out.dtc) out.dtc = decodeDtcBytes(hex.slice(6, 10));
      }
      for (const pid of ['04', '05', '06', '07', '0B', '0C', '0D', '0E', '0F', '11']) {
        const r = await this.send('02' + pid + '00', 3000);
        for (const hex of messages(r)) {
          if (hex.startsWith('42' + pid + '00') && !(pid in out.values)) {
            const data = (hex.slice(6).match(/.{2}/g) || []).map((h) => parseInt(h, 16));
            if (data.length >= (BYTES[pid] || 1)) out.values[pid] = DECODE[pid](data);
          }
        }
      }
      return out.dtc || Object.keys(out.values).length ? out : null;
    }

    async readVin() {
      const text = await this.send('0902', 6000);
      let hex = '';
      if (this.isCan) {
        const msg = messages(text).find((m) => m.startsWith('4902'));
        if (!msg) return null;
        hex = msg.slice(6); // 49 02 + number-of-items byte
      } else {
        for (const h of messages(text)) if (h.startsWith('4902')) hex += h.slice(6); // 49 02 + sequence byte
      }
      const vin = (hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16)).filter((n) => n > 32 && n < 127)
        .map((n) => String.fromCharCode(n)).join('').replace(/[^A-HJ-NPR-Z0-9]/g, '');
      return vin.length >= 17 ? vin.slice(0, 17) : null;
    }
  }

  root.ELM327 = ELM327;
  root.ELM327.decodeDtcBytes = decodeDtcBytes; // exported for tests
  root.ELM327.DECODE = DECODE;
  root.ELM327.messages = messages;
  root.ELM327.BYTES = BYTES;
  root.ELM327.monitorName = monitorName;
  if (typeof module !== 'undefined') module.exports = ELM327;
})(typeof window !== 'undefined' ? window : globalThis);
