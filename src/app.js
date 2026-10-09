const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { config, assertProductionConfig } = require('./config');
const { errorHandler, HttpError } = require('./lib/http');
const { authenticate, subscriptionGuard } = require('./middleware/auth');
const db = require('./db');
const monitor = require('./lib/monitor');
const audit = require('./middleware/audit');

function createApp() {
  assertProductionConfig();
  if (!config.jwtSecret) config.jwtSecret = crypto.randomBytes(32).toString('hex'); // dev only: sessions reset on restart

  monitor.init();
  const app = express();
  app.use(monitor.requestLogger);
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    strictTransportSecurity: config.isProd,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        formAction: ["'self'", 'https://www.payfast.co.za', 'https://sandbox.payfast.co.za'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
  }));
  if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(',') }));

  // PayFast webhook first: form-encoded, unauthenticated.
  const billing = require('./routes/billing');
  app.use('/api/billing/itn', billing.itn);

  app.use('/api', express.json({ limit: '2mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', async (_req, res) => {
    try { await db.query('SELECT 1'); res.json({ ok: true }); } catch (_) { res.status(503).json({ ok: false }); }
  });
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/reference', require('./routes/reference'));
  app.use('/api/public', require('./routes/public'));

  app.use('/api', authenticate);
  app.use('/api', audit);
  app.use('/api/billing', billing.router);      // reachable even when the subscription is inactive
  app.use('/api/shop', require('./routes/shop')); // profile edits are guarded inside; export/erasure always work
  app.use('/api', subscriptionGuard);

  const rec = require('./routes/records');
  const sc = require('./routes/scans');
  app.use('/api/customers', rec.customers);
  app.use('/api/vehicles', rec.vehicles);
  app.use('/api/inspections', rec.inspections);
  app.use('/api/remaps', rec.remaps);
  app.use('/api/jobs', rec.jobs);
  app.use('/api/parts', rec.parts);
  app.use('/api/scans', sc.scans);
  app.use('/api/dtc', sc.dtc);
  app.use('/api/invoices', require('./routes/invoices'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/tuning', require('./routes/tuning'));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', extensions: ['html'] }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
