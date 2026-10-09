/* ELM327 driver over the Web Serial API (Chrome / Edge, secure context or localhost).
 * Only standard SAE J1979 Mode 01 PIDs are decoded. Nothing here fabricates readings:
 * if the adapter or ECU does not answer, the value is null. */
(function (root) {
  'use strict';

  // Decoders for standard Mode 01 PIDs. `b` = data bytes after the "41 xx" header.
  const DECODE = {
    '04': (b) => b[0] * 100 / 255,
    '05': (b) => b[0] - 40,
    '06': (b) => (b[0] - 128) * 100 / 128,
    '07': (b) => (b[0] - 128) * 100 / 128,
    '0B': (b) => b[0],
    '0C': (b) => (256 * b[0] + b[1]) / 4,
    '0D': (b) => b[0],
    '0E': (b) => b[0] / 2 - 64,
    '0F': (b) => b[0] - 40,
    '10': (b) => (256 * b[0] + b[1]) / 100,
    '11': (b) => b[0] * 100 / 255,
    '14': (b) => b[0] / 200,
    '1F': (b) => 256 * b[0] + b[1],
    '2F': (b) => b[0] * 100 / 255,
    '31': (b) => 256 * b[0] + b[1],
    '33': (b) => b[0],
    '42': (b) => (256 * b[0] + b[1]) / 1000,
    '46': (b) => b[0] - 40,
    '5C': (b) => b[0] - 40,
    '5E': (b) => (256 * b[0] + b[1]) / 20,
  };
  const BYTES = { '0C': 2, '10': 2, '1F': 2, '31': 2, '42': 2, '5E': 2 };

  const ERRORS = ['NO DATA', 'UNABLE TO CONNECT', 'BUS INIT', 'CAN ERROR', 'BUFFER FULL', 'BUS BUSY', 'FB ERROR', 'DATA ERROR', 'STOPPED', 'ERROR', '?'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    }

    static isSupported() { return 'serial' in navigator; }

    async connect({ baudRate = 38400, protocolCmd = 'ATSP0' } = {}) {
      if (!ELM327.isSupported()) throw new Error('Web Serial is not available. Use Chrome or Edge on a computer.');
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate });
      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this._pump();
      this.connected = true;

      await this.send('ATZ', 3000);
      await this.send('ATE0'); await this.send('ATL0'); await this.send('ATS0');
      await this.send('ATH0'); await this.send('ATAT1');
      await this.send(protocolCmd);
      // First real query triggers protocol search; allow a long timeout.
      const r = await this.send('0100', 15000);
      if (!/4100/.test(r.replace(/\s/g, ''))) {
        throw new Error(this._explain(r) || 'The adapter is connected but the car did not answer. Turn the ignition on and check the protocol.');
      }
      this.supported = this._parseSupported(r);
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
          if (Date.now() - start > timeout) { this.onLog('!', 'timeout'); return ''; }
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

    _parseSupported(text) {
      const set = new Set();
      const hex = text.replace(/[^0-9A-F]/gi, '').toUpperCase();
      const i = hex.indexOf('4100');
      if (i < 0) return set;
      const bytes = hex.slice(i + 4, i + 12);
      for (let n = 0; n < 32; n++) {
        const byte = parseInt(bytes.substr(Math.floor(n / 8) * 2, 2), 16);
        if (!Number.isNaN(byte) && (byte >> (7 - (n % 8))) & 1) set.add((n + 1).toString(16).toUpperCase().padStart(2, '0'));
      }
      return set;
    }

    // Returns the decoded value of a standard Mode 01 PID, or null if unsupported / no answer.
    async readPid(pid) {
      const p = pid.toUpperCase();
      const decode = DECODE[p];
      if (!decode) return null;
      const text = await this.send('01' + p);
      for (const line of text.split('\n')) {
        const hex = line.replace(/^\d:/, '').replace(/[^0-9A-F]/gi, '').toUpperCase();
        if (hex.startsWith('41' + p)) {
          const data = hex.slice(4).match(/.{2}/g)?.map((h) => parseInt(h, 16)) || [];
          if (data.length < (BYTES[p] || 1)) return null;
          return decode(data);
        }
      }
      return null;
    }

    async _dtcs(cmd, respHeader) {
      const text = await this.send(cmd, 6000);
      if (/NO DATA/i.test(text) && !new RegExp(respHeader, 'i').test(text.replace(/\s/g, ''))) return [];
      const codes = [];
      for (const line of text.split('\n')) {
        let hex = line.replace(/^\d:/, '').replace(/[^0-9A-F]/gi, '').toUpperCase();
        if (!hex.startsWith(respHeader)) continue;
        hex = hex.slice(respHeader.length);
        if (this.isCan) hex = hex.slice(2); // CAN: count byte follows the header
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
      return /44/.test(t.replace(/\s/g, ''));
    }

    readPermanentDtcs() { return this._dtcs('0A', '4A'); }

    // Mode 01 PID 01: MIL state, stored-code count and emissions readiness monitors.
    async readReadiness() {
      const text = await this.send('0101', 6000);
      for (const line of text.split('\n')) {
        const hex = line.replace(/^\d:/, '').replace(/[^0-9A-F]/gi, '').toUpperCase();
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
      for (const line of t.split('\n')) {
        const hex = line.replace(/^\d:/, '').replace(/[^0-9A-F]/gi, '').toUpperCase();
        if (hex.startsWith('420200')) out.dtc = decodeDtcBytes(hex.slice(6, 10));
      }
      for (const pid of ['04', '05', '06', '07', '0B', '0C', '0D', '0E', '0F', '11']) {
        const r = await this.send('02' + pid + '00', 3000);
        for (const line of r.split('\n')) {
          const hex = line.replace(/^\d:/, '').replace(/[^0-9A-F]/gi, '').toUpperCase();
          if (hex.startsWith('42' + pid + '00')) {
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
      const lines = text.split('\n');
      if (this.isCan) {
        for (const line of lines) {
          if (!line.includes(':') && /^[0-9A-F]{3}$/i.test(line)) continue; // CAN length line
          hex += line.replace(/^\d:/, '').replace(/[^0-9A-F]/gi, '').toUpperCase();
        }
        const i = hex.indexOf('4902');
        if (i < 0) return null;
        hex = hex.slice(i + 6);
      } else {
        for (const line of lines) {
          const h = line.replace(/[^0-9A-F]/gi, '').toUpperCase();
          if (h.startsWith('4902')) hex += h.slice(6);
        }
      }
      const vin = (hex.match(/.{2}/g) || []).map((h) => parseInt(h, 16)).filter((n) => n > 32 && n < 127)
        .map((n) => String.fromCharCode(n)).join('').replace(/[^A-HJ-NPR-Z0-9]/g, '');
      return vin.length >= 17 ? vin.slice(0, 17) : null;
    }
  }

  root.ELM327 = ELM327;
  root.ELM327.decodeDtcBytes = decodeDtcBytes; // exported for tests
  root.ELM327.DECODE = DECODE;
  if (typeof module !== 'undefined') module.exports = ELM327;
})(typeof window !== 'undefined' ? window : globalThis);
