const fs = require('fs');
const path = require('path');
const DTCS = require('../data/dtcs');
const { genericInfo } = require('../data/dtc-generic');

// Optional licensed/imported code library: `npm run import-dtc -- yourfile.csv` writes src/data/dtc-extra.json.
// Built-in curated entries win over imported ones for the same code.
let extra = [];
try { extra = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dtc-extra.json'), 'utf8')); } catch (_) { /* none imported */ }
const byCode = new Map(extra.map((d) => [d.code, d]));
for (const d of DTCS) byCode.set(d.code, d);
// Full list for the reference page: curated + imported + every generic code the J2012 rules can name.
let allCache = null;
function all() {
  if (allCache) return allCache;
  const merged = new Map(byCode);
  const candidates = [...Array.from({ length: 1000 }, (_, i) => 'P0' + String(i).padStart(3, '0')), ...Array.from({ length: 1000 }, (_, i) => 'P2' + String(i).padStart(3, '0')), ...Array.from({ length: 256 }, (_, i) => 'U0' + i.toString(16).toUpperCase().padStart(3, '0'))];
  for (const c of candidates) if (!merged.has(c)) { const g = genericInfo(c); if (g) merged.set(c, g); }
  allCache = [...merged.values()].sort((x, y) => x.code.localeCompare(y.code));
  return allCache;
}
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
  const gen = valid && genericInfo(c);
  if (gen) return { ...gen, known: true, kind: codeKind(c) };
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
