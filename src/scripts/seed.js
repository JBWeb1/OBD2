// Creates a demo shop for local development. Never run against production data.
const bcrypt = require('bcryptjs');
const db = require('../db');
const { migrate } = require('./migrate');

async function seed() {
  await migrate();
  const hash = await bcrypt.hash('demo1234', 10);
  const t = await db.query(
    `INSERT INTO tenants (name, plan, plan_status, trial_ends_at, email) VALUES ('Demo Motors','pro','trial', now() + interval '14 days','demo@example.com') RETURNING id`);
  const id = t.rows[0].id;
  await db.query(`INSERT INTO users (tenant_id,email,password_hash,name,role) VALUES ($1,'demo@example.com',$2,'Demo Admin','admin')`, [id, hash]);
  const c = await db.query(`INSERT INTO customers (tenant_id, first_name, last_name, phone) VALUES ($1,'Sample','Customer','000 000 0000') RETURNING id`, [id]);
  await db.query(`INSERT INTO vehicles (tenant_id, customer_id, make, model, year, engine) VALUES ($1,$2,'Volkswagen','Polo',2017,'1.0 TSI')`, [id, c.rows[0].id]);
  console.log('Seeded. Login: demo@example.com / demo1234');
}
module.exports = { seed };

if (require.main === module) {
  seed().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
