// In-process daily scheduler. For several app instances set RUN_SCHEDULER=false on all but one (reminders are idempotent anyway).
const { config } = require('../config');
const { runReminders } = require('../lib/reminders');
const monitor = require('../lib/monitor');

let lastRun = null;
function start() {
  setInterval(async () => {
    const now = new Date(); const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== config.reminderHourUtc || lastRun === day) return;
    lastRun = day;
    try { monitor.log('info', 'reminders', await runReminders(now)); } catch (e) { monitor.captureError(e, { where: 'scheduler' }); }
  }, 5 * 60 * 1000).unref();
}
module.exports = { start };
