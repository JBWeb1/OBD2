// Small whitelist-based body sanitiser. Spec maps column -> type.
// Types: text, longtext, int, date, json, email, enum:a|b|c
// Returns { values, error }. Unknown keys are dropped silently.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function coerce(type, raw) {
  if (raw === null || raw === '') return { ok: true, value: null };
  if (type === 'text' || type === 'longtext') {
    if (typeof raw !== 'string') return { ok: false };
    const s = raw.trim();
    if (s.length > (type === 'text' ? 300 : 5000)) return { ok: false };
    return { ok: true, value: s };
  }
  if (type === 'email') {
    if (typeof raw !== 'string' || raw.length > 254 || !EMAIL_RE.test(raw.trim())) return { ok: false };
    return { ok: true, value: raw.trim().toLowerCase() };
  }
  if (type === 'int') {
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (!Number.isInteger(n) || Math.abs(n) > 2_000_000_000) return { ok: false };
    return { ok: true, value: n };
  }
  if (type === 'date') {
    if (typeof raw !== 'string' || !DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) return { ok: false };
    return { ok: true, value: raw };
  }
  if (type === 'datetime') {
    if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) return { ok: false };
    return { ok: true, value: raw };
  }
  if (type === 'json') {
    if (typeof raw !== 'object') return { ok: false };
    if (JSON.stringify(raw).length > 200_000) return { ok: false };
    return { ok: true, value: JSON.stringify(raw) };
  }
  if (type.startsWith('enum:')) {
    const allowed = type.slice(5).split('|');
    if (typeof raw !== 'string' || !allowed.includes(raw)) return { ok: false };
    return { ok: true, value: raw };
  }
  return { ok: false };
}

function sanitize(body, spec, { partial = false, required = [] } = {}) {
  const values = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const [col, type] of Object.entries(spec)) {
    if (!(col in src)) continue;
    const r = coerce(type, src[col]);
    if (!r.ok) return { error: `Invalid value for "${col}"` };
    values[col] = r.value;
  }
  if (!partial) {
    for (const col of required) {
      if (values[col] === undefined || values[col] === null) return { error: `"${col}" is required` };
    }
  }
  return { values };
}

module.exports = { sanitize };
