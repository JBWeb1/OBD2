// Email + SMS/WhatsApp senders. Providers are plain HTTPS APIs (no extra dependencies):
//   Email: Resend (RESEND_API_KEY, MAIL_FROM)     SMS/WhatsApp: Twilio (TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM)
// With no provider configured, messages are logged (development) and kept in `outbox` (tests).
const { config } = require('../config');

const outbox = [];

async function sendEmail({ to, subject, text, html, attachments = [] }) {
  const msg = { to, subject, text, html, attachments: attachments.map((a) => ({ filename: a.filename, bytes: a.content.length })) };
  if (!config.mail.resendKey) {
    outbox.push({ type: 'email', ...msg, attachmentsRaw: attachments });
    if (!config.isTest) console.log(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
    return { delivered: false, dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.mail.from, to: [to], subject, text, html,
      attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
    }),
  });
  if (!r.ok) throw new Error(`Email provider error ${r.status}`);
  return { delivered: true };
}

async function sendSms({ to, body }) {
  const t = config.sms;
  if (!t.sid || !t.token || !t.from) {
    outbox.push({ type: 'sms', to, body });
    if (!config.isTest) console.log(`[sms:dev] to=${to} ${body}`);
    return { delivered: false, dev: true };
  }
  const isWa = t.from.startsWith('whatsapp:');
  const dest = (isWa ? 'whatsapp:' : '') + to;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${t.sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${t.sid}:${t.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: dest, From: t.from, Body: body }).toString(),
  });
  if (!r.ok) throw new Error(`SMS provider error ${r.status}`);
  return { delivered: true };
}

// Normalises a South African number to E.164 (+27…). Returns null if it doesn't look valid.
function normalisePhone(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('0')) p = '+27' + p.slice(1);
  else if (/^27\d{9}$/.test(p)) p = '+' + p;
  return /^\+\d{9,15}$/.test(p) ? p : null;
}

module.exports = { sendEmail, sendSms, normalisePhone, outbox };
