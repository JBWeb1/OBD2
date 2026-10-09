// Structured logging + optional Sentry (install with `npm i @sentry/node` and set SENTRY_DSN).
const crypto = require('crypto');
const { config } = require('../config');

let sentry = null;
function init() {
  if (!config.sentryDsn) return;
  try { sentry = require('@sentry/node'); sentry.init({ dsn: config.sentryDsn, environment: config.isProd ? 'production' : 'development' }); }
  catch (_) { console.warn('SENTRY_DSN is set but @sentry/node is not installed (npm i @sentry/node).'); }
}
const log = (level, msg, extra = {}) => { if (!config.isTest) console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra })); };
const captureError = (err, ctx) => { log('error', err.message, { stack: err.stack, ...ctx }); if (sentry) sentry.captureException(err, { extra: ctx }); };

function requestLogger(req, res, next) {
  req.id = crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  const start = Date.now();
  res.on('finish', () => { if (req.originalUrl.startsWith('/api')) log('info', 'req', { id: req.id, m: req.method, p: req.originalUrl.split('?')[0], s: res.statusCode, ms: Date.now() - start, u: req.user && req.user.id }); });
  next();
}
module.exports = { init, log, captureError, requestLogger };
