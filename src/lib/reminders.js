// Service reminders: for workshops that switched reminders on, message customers whose vehicle is due for service
// within the next 7 days (or overdue). Idempotent: each vehicle is "claimed" in the database before sending,
// so running on several servers, or twice in a day, never double-sends.
const db = require('../db');
const { sendEmail, sendSms, normalisePhone } = require('./mailer');
const monitor = require('./monitor');

const ymd = (d) => d.toISOString().slice(0, 10);
const d10 = (x) => (x instanceof Date ? ymd(x) : String(x).slice(0, 10)); // pg returns DATE as a string, pg-mem as a Date
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

async function runReminders(now = new Date()) {
  const today = ymd(now); const horizon = ymd(addDays(now, 7));
  const { rows } = await db.query(
    `SELECT v.id, v.make, v.model, v.plate, v.next_service_on, v.next_service_km, v.reminder_sent_on,
            c.first_name, c.email, c.phone, t.name AS shop, t.phone AS shop_phone
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id AND c.tenant_id = v.tenant_id
       JOIN tenants t ON t.id = v.tenant_id
      WHERE t.reminders_enabled = true
        AND (t.plan_status = 'active' OR (t.plan_status = 'trial' AND (t.trial_ends_at IS NULL OR t.trial_ends_at > $2)))
        AND v.next_service_on IS NOT NULL AND v.next_service_on <= $1`, [horizon, now]);
  const result = { checked: rows.length, sent: 0, skipped: 0, failed: 0 };
  for (const v of rows) {
    const due = d10(v.next_service_on);
    const last = v.reminder_sent_on ? d10(v.reminder_sent_on) : null;
    // already reminded for this service date (reminder sent within 21 days before it, or after)?
    if (last && last >= ymd(addDays(new Date(due), -21))) { result.skipped++; continue; }
    const claim = await db.query(
      `UPDATE vehicles SET reminder_sent_on = $2 WHERE id = $1 AND (reminder_sent_on IS NULL OR reminder_sent_on < $3) RETURNING id`,
      [v.id, today, ymd(addDays(new Date(due), -21))]);
    if (!claim.rows[0]) { result.skipped++; continue; }
    const when = due < today ? `was due on ${due}` : due === today ? 'is due today' : `is due on ${due}`;
    const car = `${v.make} ${v.model}${v.plate ? ' (' + v.plate + ')' : ''}`;
    const text = `Hi ${v.first_name}, the service for your ${car} ${when}${v.next_service_km ? ` (or at ${v.next_service_km.toLocaleString('en-ZA')} km)` : ''}. Contact ${v.shop}${v.shop_phone ? ' on ' + v.shop_phone : ''} to book. To stop these reminders, tell ${v.shop}.`;
    try {
      let delivered = false;
      if (v.email) { await sendEmail({ to: v.email, subject: `Service reminder: ${car}`, text }); delivered = true; }
      const ph = normalisePhone(v.phone);
      if (ph) { await sendSms({ to: ph, body: text }); delivered = true; }
      if (delivered) result.sent++; else result.skipped++;
    } catch (e) {
      result.failed++;
      await db.query('UPDATE vehicles SET reminder_sent_on = $2 WHERE id = $1', [v.id, last]); // release the claim so tomorrow retries
      monitor.captureError(e, { where: 'reminders', vehicle: v.id });
    }
  }
  return result;
}
module.exports = { runReminders };
