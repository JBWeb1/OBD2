// One-off run (cron): npm run reminders
const { runReminders } = require('../lib/reminders');
runReminders().then((r) => { console.log(r); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
