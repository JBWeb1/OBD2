// Update-availability check (notification only). It NEVER downloads or runs code — it tells an admin that a newer
// release exists so a human can deploy it. Off unless UPDATE_CHECK_URL is set; the URL must return JSON shaped like
//   { "version": "1.2.0", "url": "https://.../releases/1.2.0", "notes": "..." }
// (a GitHub "latest release" API response — tag_name/html_body — is also understood). Result is cached so the app
// checks at most once an hour, and any failure degrades to "current version only".
const { config } = require('../config');
const V = require('./version');

// Compare dotted numeric versions. Pre-release/build suffixes are ignored. Returns -1 | 0 | 1 (a<b | a==b | a>b).
function semverCmp(a, b) {
  const norm = (s) => String(s || '').replace(/^v/i, '').split(/[+-]/)[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = norm(a), y = norm(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function parseFeed(data) {
  if (!data || typeof data !== 'object') return null;
  const version = data.version || (typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/i, '') : null);
  if (!version) return null;
  return { version: String(version), url: data.url || data.html_url || null, notes: data.notes || data.name || null };
}

let cache = { at: 0, latest: null };
const CACHE_MS = 60 * 60 * 1000;

// Returns { current, build, updateAvailable, latest, url, notes, checkedAt, enabled }.
async function check({ fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  const base = { current: V.version, build: V.build, enabled: Boolean(config.updateCheckUrl), updateAvailable: false, latest: null, url: null, notes: null, checkedAt: null };
  if (!config.updateCheckUrl) return base;
  if (!force && cache.latest && now - cache.at < CACHE_MS) {
    return { ...base, ...applyLatest(cache.latest), checkedAt: new Date(cache.at).toISOString() };
  }
  try {
    const r = await fetchImpl(config.updateCheckUrl, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`update feed ${r.status}`);
    const latest = parseFeed(await r.json());
    cache = { at: now, latest };
    return { ...base, ...applyLatest(latest), checkedAt: new Date(now).toISOString() };
  } catch (_) {
    return base; // offline or bad feed: report current only, never error the request
  }
}

function applyLatest(latest) {
  if (!latest) return {};
  return { latest: latest.version, url: latest.url, notes: latest.notes, updateAvailable: semverCmp(latest.version, V.version) > 0 };
}

function _reset() { cache = { at: 0, latest: null }; }

module.exports = { check, semverCmp, parseFeed, _reset };
