# DiagnosticOS

Multi-tenant SaaS for dealerships and tuning shops: live OBD2 scanning with a USB ELM327 adapter (in the browser),
fault codes, customers, vehicles, remap log, inspections, invoices/quotes, vehicle history reports, team accounts,
and PayFast subscriptions.

Stack: Node 22 + Express, PostgreSQL, vanilla-JS frontend (no build step), Web Serial API for the adapter.
Vehicle database: 190+ makes and 2,300+ models (names only), editable in `src/data/cars.js` / `cars-extra.js`.

## Run it

### Docker (easiest)
```bash
cp .env.example .env        # set JWT_SECRET (see below)
docker compose up --build   # app on http://localhost:3000, Postgres included
```

### Without Docker
```bash
npm install
cp .env.example .env        # point DATABASE_URL at your Postgres
npm run migrate             # creates tables
npm run seed                # optional demo shop: demo@example.com / demo1234
npm start
```

Generate a secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
In production (`NODE_ENV=production`) the server refuses to start with a weak or missing `JWT_SECRET`.
Serve it behind HTTPS (Web Serial needs a secure context except on localhost) and set `TRUST_PROXY=1`.

## What's included
Diagnostics: 48 standard live sensors (pick which to poll; up to 6 per request on CAN), automatic adapter reconnect, stored/pending/permanent fault codes, readiness monitors + MIL, freeze frame, on-board monitor test results (Mode 06, CAN), VIN, raw terminal, scan history with graphs and two-scan overlay.
Workshop: jobs board, customers, vehicles (next-service dates), remap log, inspections with photos, parts and stock (invoices deduct stock), quotes and invoices with PDF + email + customer payment links, vehicle history reports (PDF), service reminders by email/SMS/WhatsApp.
Account: email verification, password reset, shop profile + logo, team, audit log, data export and account deletion, PayFast subscriptions.

## Using the scanner
1. Use **Chrome or Edge on a computer** (Firefox/Safari have no Web Serial). Plug in a USB ELM327 adapter.
2. Ignition on. Scanner → pick protocol (Auto-detect works for most cars) → **Connect adapter**.
3. Under **Sensors**, tick what to watch (the list only shows what the car supports; fewer sensors = faster updates). **Start live scan** polls them; if the adapter drops out, the app reconnects by itself up to 3 times. **Stop & save** stores min/max/avg and a sampled time series on the vehicle.
4. **Fault codes** reads Mode 03 (stored) and 07 (pending), looks codes up, saves them to the vehicle, and can clear them (Mode 04, with a confirmation).
5. **Monitor tests (Mode 06)** shows the car's own self-test results (catalyst, O2 sensors, EGR, EVAP, misfire counts) with pass/fail against the car's limits — useful for spotting a part that is about to fail before it sets a code. Saved to the vehicle and listed on its report. CAN cars only.

Honest limits:
- Only **standard SAE J1979** PIDs are decoded (they work on any OBD2 car). Manufacturer-specific PIDs (VAG 21xx, BMW etc.) are listed in the PID reference as *unverified* and are never polled — they need validating against real ECUs first.
- Fault-code descriptions: a curated list with workshop tips, plus the generic SAE J2012 meanings (misfire per cylinder, injectors, coils, O2 sensors, sensor circuits, catalyst, EVAP, network...) generated from the standard's numbering. Manufacturer-specific codes (P1xxx etc.) show as "look up in service data".
- Mode 06 test IDs and some unit codes are manufacturer-defined; unknown units are shown raw. Pass/fail is always right because it compares the unscaled values.
- **Demo mode** is clearly labelled; its values are simulated, stored as `source=demo`, and don't count toward plan limits.
- Cheap clone adapters (v2.1 etc.) are unreliable; use a genuine/known-good ELM327 or OBDLink.
- The ELM327 driver is tested against a simulated adapter, **not yet against a physical car** — do a test on a real vehicle before selling.

## Plans and billing
| Plan | Price (ZAR/mo) | Live scans/month | Team members |
|---|---|---|---|
| Starter | 499 | 100 | 2 |
| Pro | 999 | 500 | 5 |
| Enterprise | 2,499 | unlimited | unlimited |

A live scan counts toward the limit; reading or clearing fault codes, readiness and freeze frame is always free.

New shops get a 14-day trial. After the trial ends (or on cancellation) the account is **read-only** (writes return HTTP 402) until a plan is paid. Limits live in `src/config.js`.

### PayFast
1. Create a PayFast merchant account (use the sandbox first: https://sandbox.payfast.co.za).
2. Set `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` (set the same passphrase in the PayFast dashboard) and `APP_URL` (a public HTTPS URL — PayFast must be able to reach `APP_URL/api/billing/itn`).
3. Billing → Subscribe sends the shop to PayFast; the ITN webhook verifies the signature, PayFast's source IP, the amount, and PayFast's server-side validation before activating the plan.
4. Set `PAYFAST_SANDBOX=false` only when going live.
Cancelling a subscription is done from the PayFast side; the `CANCELLED` ITN then marks the shop cancelled. Test the full cycle in the sandbox before charging real customers.

## Email, SMS and reminders
- **Email:** set `RESEND_API_KEY` and `MAIL_FROM` (verify your sending domain with Resend). Without a key emails are printed to the server log, so nothing is sent.
- **SMS/WhatsApp:** set `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`. WhatsApp business-initiated messages need a Twilio-approved template; plain SMS works immediately.
- **Reminders:** each workshop opts in under Settings. A daily job (default 09:00 SA time, `REMINDER_HOUR_UTC`) messages customers whose vehicle's next service date is within 7 days or overdue, once per service date. Run manually with `npm run reminders` or from cron. Only enable for customers who agreed to receive service messages.

## Customer payment links
Each workshop adds its **own** PayFast merchant ID/key/passphrase in Settings (encrypted at rest). "Pay link" on an invoice creates a public page; the customer pays into the workshop's PayFast account and the invoice flips to *paid* when PayFast's verified notification arrives. Your platform never touches those funds. Test in the PayFast sandbox first. Amounts are treated as VAT-inclusive (15%) when a VAT number is set.

## Fault-code library
Ships with a small curated list. To add a licensed dataset: `npm run import-dtc -- codes.csv` (columns: `code, description, system, cause, tip, severity, make`). Imported codes fill gaps; built-in entries win on conflicts. **Only import data you have the right to use.**

## Operations
- `GET /api/health` checks the database (use it for uptime monitoring).
- Logs are JSON lines with request IDs. Optional Sentry: `npm i @sentry/node` and set `SENTRY_DSN`.
- Backups: `scripts/backup.sh` (pg_dump + retention). Schedule it with cron and copy backups off the server; test a restore.
- Run `docs/REAL-CAR-TEST.md` before selling. What to build next: `docs/ROADMAP.md`.
- Legal: `public/privacy.html` and `public/terms.html` are **templates** with [BRACKETS]; have a South African attorney complete them. POPIA applies.

## Security notes
- Every query is scoped by `tenant_id`; foreign keys are checked to belong to the same tenant (covered by tests).
- Passwords hashed with bcrypt; JWTs are re-checked against the database on every request; auth endpoints are rate limited; strict CSP (no inline scripts); all user content is HTML-escaped in the UI.
- Included: email verification, password reset, password change (Settings), audit log, data export and erasure. Changing or resetting a password signs out every other session. Not included yet: 2FA and per-customer consent records.

## Tests
```bash
npm test                      # API, account, features, data + ELM327 driver tests (in-memory Postgres)
TEST_DATABASE_URL=postgres://user@localhost/scratch npm test   # same suite on a real Postgres (throwaway schema per run)
node test/dev-server.js &     # in-memory server on :3111
node test/e2e.js              # headless-browser smoke test (needs playwright)
node test/e2e-scanner.js      # scanner UI against a simulated ELM327: connect, live scan, cable pull + reconnect, codes, Mode 06
```

## Layout
```
db/schema.sql         tables
src/routes/           API (auth, records, scans, invoices, billing, reports, users, reference)
src/lib/              validation, CRUD factory, PayFast, DTC lookup
src/middleware/       auth + subscription guard
src/data/             makes/models, PIDs, DTCs, inspection items
public/               index.html, app.js, elm327.js, style.css
```
