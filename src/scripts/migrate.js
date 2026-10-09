const fs = require('fs');
const path = require('path');
const db = require('../db');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8');
  await db.query(sql);
  await db.query(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'upgrade.sql'), 'utf8'));
}
module.exports = { migrate };

if (require.main === module) {
  migrate().then(() => { console.log('Schema ready.'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
