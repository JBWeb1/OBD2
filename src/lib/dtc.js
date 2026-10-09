const fs = require('fs');
const path = require('path');
const DTCS = require('../data/dtcs');

// Optional licensed/imported code library: `npm run import-dtc -- yourfile.csv` writes src/data/dtc-extra.json.
// Built-in curated entries win over imported ones for the same code.
let extra = [];
try { extra = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dtc-extra.json'), 'utf8')); } catch (_) { /* none imported */ }
const byCode = new Map(extra.map((d) => [d.code, d]));
for (const d of DTCS) byCode.set(d.code, d);
const all = () => [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
const CODE_RE = /^[PCBU][0-3][0-9A-F]{3}$/;

const SYSTEMS = { P: 'Powertrain', C: 'Chassis', B: 'Body', U: 'Network' };

// SAE J2012: second character 0 = generic, 1 = manufacturer specific, 2 = generic (powertrain), 3 = mixed.
function codeKind(code) {
  const d = code[1];
  if (code[0] === 'P') return d === '0' || d === '2' ? 'generic' : d === '1' ? 'manufacturer' : 'mixed';
  return d === '0' ? 'generic' : 'manufacturer';
}

function lookup(code) {
  const c = String(code || '').toUpperCase();
  const known = byCode.get(c);
  if (known) return { ...known, known: true, kind: codeKind(c) };
  const valid = CODE_RE.test(c);
  return {
    code: c,
    known: false,
    sys: valid ? SYSTEMS[c[0]] : 'Unknown',
    kind: valid ? codeKind(c) : 'unknown',
    name: 'Not in the local reference list',
    cause: valid && codeKind(c) === 'manufacturer'
      ? 'Manufacturer-specific code — look it up in the manufacturer service data for this make/model/year.'
      : 'Look this code up in the service data for this vehicle.',
    tip: 'Record freeze-frame data, then diagnose against the manufacturer procedure.',
    sev: 'unknown',
  };
}

module.exports = {
  all, lookup, CODE_RE, SYSTEMS };
