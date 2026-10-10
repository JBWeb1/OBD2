require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  corsOrigin: process.env.CORS_ORIGIN || '',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: process.env.DATABASE_URL || '',
  trustProxy: process.env.TRUST_PROXY || '',
  mail: { resendKey: process.env.RESEND_API_KEY || '', from: process.env.MAIL_FROM || 'DiagnosticOS <no-reply@example.com>' },
  sms: { sid: process.env.TWILIO_SID || '', token: process.env.TWILIO_TOKEN || '', from: process.env.TWILIO_FROM || '' },
  sentryDsn: process.env.SENTRY_DSN || '',
  updateCheckUrl: process.env.UPDATE_CHECK_URL || '',
  reminderHourUtc: Number(process.env.REMINDER_HOUR_UTC || 7),
  payfast: {
    sandbox: process.env.PAYFAST_SANDBOX !== 'false',
    merchantId: process.env.PAYFAST_MERCHANT_ID || '',
    merchantKey: process.env.PAYFAST_MERCHANT_KEY || '',
    passphrase: process.env.PAYFAST_PASSPHRASE || '',
  },
  allowDevPlanSwitch: !isProd && process.env.ALLOW_DEV_PLAN_SWITCH === 'true',
};

config.payfast.enabled = Boolean(config.payfast.merchantId && config.payfast.merchantKey);

// Plans. Prices are in cents (ZAR). Limits are enforced by the API.
config.plans = {
  starter:    { name: 'Starter',    priceCents: 49900,  scansPerMonth: 100,      users: 2 },
  pro:        { name: 'Pro',        priceCents: 99900,  scansPerMonth: 500,      users: 5 },
  enterprise: { name: 'Enterprise', priceCents: 249900, scansPerMonth: Infinity, users: Infinity },
};
config.trialDays = 14;

function assertProductionConfig() {
  if (!isProd) return;
  const weak = !config.jwtSecret || config.jwtSecret.length < 32 || /change-me|dev-only/i.test(config.jwtSecret);
  if (weak) throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production.');
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required.');
}

module.exports = { config, assertProductionConfig };
