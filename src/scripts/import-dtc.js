// Imports a fault-code list (CSV) into src/data/dtc-extra.json.
//   npm run import-dtc -- path/to/codes.csv
// Columns (header row required, any order): code, description (or name), system, cause, tip, severity, make
// Only import data you are licensed to use. Rows with invalid codes are skipped and reported.
const fs = require('fs');
const path = require('path');
const { CODE_RE } = require('../lib/dtc');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

function convert(text) {
  const [head, ...body] = parseCsv(text);
  const col = (n) => head.findIndex((h) => h.trim().toLowerCase() === n);
  const idx = { code: col('code'), name: Math.max(col('description'), col('name')), sys: col('system'), cause: col('cause'), tip: col('tip'), sev: col('severity'), make: col('make') };
  if (idx.code < 0 || idx.name < 0) throw new Error('CSV needs "code" and "description" columns');
  const out = []; const skipped = [];
  for (const r of body) {
    const code = (r[idx.code] || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) { skipped.push(code || '(blank)'); continue; }
    const sev = (r[idx.sev] || '').trim().toLowerCase();
    out.push({
      code, name: (r[idx.name] || '').trim(), sys: idx.sys >= 0 ? (r[idx.sys] || '').trim() : '',
      cause: idx.cause >= 0 ? (r[idx.cause] || '').trim() : '', tip: idx.tip >= 0 ? (r[idx.tip] || '').trim() : '',
      sev: ['critical', 'warning', 'advisory'].includes(sev) ? sev : 'unknown', ...(idx.make >= 0 && r[idx.make] ? { make: r[idx.make].trim() } : {}),
    });
  }
  return { out, skipped };
}
module.exports = { parseCsv, convert };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: npm run import-dtc -- codes.csv'); process.exit(1); }
  const { out, skipped } = convert(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'dtc-extra.json'), JSON.stringify(out));
  console.log(`Imported ${out.length} codes. Skipped ${skipped.length} invalid rows${skipped.length ? ': ' + skipped.slice(0, 10).join(', ') : ''}.`);
}
