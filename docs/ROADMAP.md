# DiagnosticOS roadmap

What to build next, in what order, and why. Effort: **S** = days, **M** = 1–3 weeks, **L** = a month or more.

## Where it stands (October 2026)

DiagnosticOS is one tool that replaces three things a small workshop juggles: a scan tool, a job/customer book, and an invoicing app. What works today:

- **Scanner (browser + USB ELM327):** 48 standard sensors, multi-PID reads, auto-reconnect, fault codes with generic meanings, readiness, freeze frame, Mode 06 monitor tests, VIN, scan history and graphs.
- **Workshop:** jobs board, customers, vehicles, inspections with photos, parts and stock, quotes → invoices, PDFs, email, customer payment links, service reminders, vehicle history report.
- **Business:** multi-tenant, trials, PayFast subscriptions, team accounts, audit log, POPIA export/erasure.

What it is **not** yet: tested on real cars, able to read manufacturer-specific data, or usable from a phone with a Bluetooth adapter. Those three gaps set the order below.

## Phase 0: before charging anyone (2–4 weeks)

These are prerequisites, not features. Skipping any one of them risks refunds or legal trouble.

| Item | Why | Effort |
|---|---|---|
| Run `docs/REAL-CAR-TEST.md` on 5+ cars and 2 adapters | Every driver test so far uses a simulated adapter. Real ECUs differ. | M |
| Fix whatever the real-car logs show | Expect reply-format differences; the terminal's **Save log** captures them. | S–M |
| Complete `privacy.html` / `terms.html` with an attorney | They are templates with [BRACKETS]. POPIA applies. | S (plus legal fees) |
| Full PayFast sandbox cycle: subscribe → renew → cancel → ITN | Billing bugs cost trust fastest. | S |
| Backups off the server and one restore test | `scripts/backup.sh` exists; an untested backup is no backup. | S |
| Production hosting with HTTPS (needed by Web Serial), uptime check on `/api/health`, error tracking | Basic operations. | S |

## Phase 1: get the first 10 paying workshops (months 1–3)

The goal is product–market fit with small independent workshops and tuning shops. Each item either removes a reason not to buy or makes the shop money.

### 1. Bluetooth adapters via Web Bluetooth (L), the biggest unlock
Today the scanner needs a laptop plus a USB adapter. Most technicians would rather walk to the car with a phone or tablet. Chrome on **Android** supports Web Bluetooth, and BLE ELM327-compatible adapters (OBDLink CX, Vgate iCar Pro BLE and others) are cheap and common.
- Add a BLE transport behind the same `ELM327` class (`send()` already abstracts the link; only `_open`/`_pump`/`write` change).
- Make the app installable as a PWA, with a phone-sized scanner screen.
- iPhones don't support Web Bluetooth in Safari. That needs a thin native wrapper later, or accept Android-only at first.

### 2. Customer health report link (M), which makes the shop money
A shareable page per vehicle (like the payment link, with an unguessable token) showing what the scan found in plain language: warning light, fault codes, readiness, **Mode 06 tests that failed or are close to their limit**, the technician's photos, and a quote with an **Approve** button.
- This turns a diagnosis into approved work. That is the feature a workshop owner will pay for.
- Built on existing data: scans, `monitor_tests`, inspection photos, quotes, pay links.

### 3. WhatsApp first for customer messages (M)
In South Africa customers answer WhatsApp, not email. Twilio WhatsApp is already wired up for reminders.
- Get approved message templates (job ready, quote to approve, invoice, service due).
- Send the health report link and the pay link by WhatsApp from the job card.

### 4. Job card flow polish (M)
One screen per job: vehicle → scan → findings → quote → approval → parts used → invoice → paid. Today the pieces exist on separate pages.
- Add technician time tracking per job, which feeds labour lines on the invoice.
- Show the job status to the customer on the health report page.

### 5. Offline VIN decoding (S)
Decode the make, model year and plant from the VIN (WMI + year character) when a car is connected, and prefill new vehicles. It saves typing on every new car.

### 6. Onboarding (S)
A first-run checklist (shop details → add a vehicle → connect adapter → first scan → first invoice), a demo vehicle with sample data, and a "which adapter should I buy" page. Trials only convert when the shop reaches a successful first scan.

### 7. Make the tuning section the best in its class (ongoing)
The Tuning section (self-learning engine profiles, ECU software identification, pull recorder, virtual dyno, knock and lean warnings) is the feature competitors' generic scan tools don't have. Next steps, in order of value:
- **Get shops to opt in to shared learning.** Every engine is learned faster with more cars; this is the network effect, so offer something for it (for example, a discount).
- **Wideband AFR input:** support a serial wideband controller (most output a simple serial stream) alongside the ELM327, giving real air-fuel ratio on pulls instead of commanded lambda.
- **Speed-based power** (from acceleration and vehicle mass) as a second estimate next to airflow, and for diesels and speed-density engines.
- **Weather correction** (baro and intake temperature, SAE J1349) so pulls on different days compare fairly.
- **Pull consistency score:** warn when gear, start rpm or temperatures differ between a before and an after pull.
- **Per-file results:** once software versions are labelled, show the average gain other cars got from the same tuned file.
- **Flashing:** only via a partnership with an established flash-tool maker. Don't build it on an ELM327.

## Phase 2: retention and a moat (months 3–9)

| Item | Why it matters | Effort |
|---|---|---|
| **Accounting export** (Sage Business Cloud, Xero; CSV first) | Workshops' bookkeepers will ask for it; it removes double entry. | M |
| **Online booking page** per workshop | New customers come in without phone calls; feeds the jobs board. | M |
| **Fleet accounts** (one customer, many vehicles, monthly statement) | Fleets pay reliably and bring volume; it reuses the customer/vehicle model. | M |
| **Multi-branch** (one owner, several sites, shared customers) | Unlocks the Enterprise plan. | L |
| **Scan comparisons and trends** per vehicle (fuel trims, Mode 06 values over visits) | Shows a part wearing out across visits, which no cheap scan tool does. | M |
| **Technician mobile view** for inspections with camera-first photos | Inspections happen at the car, not at a desk. | M |
| **2FA for admins**, per-customer marketing consent records | Security and POPIA hygiene, increasingly asked about. | S–M |

## Phase 3: manufacturer data (9 months+, only with licensed data)

Generic OBD2 covers emissions-related data on every car, but the money in diagnostics is in manufacturer-specific data: VAG/BMW/Toyota live values, body/ABS/airbag codes, service resets.

- **Do not reverse-engineer and ship unvalidated manufacturer PIDs.** The placeholders in `pids.js` are marked unverified for that reason. A wrong value on a brake or airbag system is a liability problem.
- Realistic routes: **license** a manufacturer data set from a data provider, or partner with an existing professional tool and integrate rather than compete.
- Service resets, coding, adaptations and other bi-directional controls need a proper professional interface (J2534 / DoIP), not an ELM327. Keep the existing rule: don't market what isn't there.

## Pricing experiments

The current plans (Starter R499, Pro R999, Enterprise R2,499 per month) are a reasonable start. Try these:

1. **Annual billing** at about two months free, which improves cash flow and retention.
2. **Starter kit:** a tested BLE adapter shipped with the first paid month, so nobody fails on a bad clone adapter.
3. **Charge for value, not scans:** once the health report exists, consider limiting reports or WhatsApp messages instead of live scans. Live-scan limits feel arbitrary to a workshop, and fault-code reads are already free.
4. **Tuning-shop tier:** remap log, before/after dyno attachments, and a boost/AFR logging preset, for a niche that pays more for fewer features.

Validate each with 5–10 real workshops before building it.

## What to measure

- **Activation:** % of trials that complete a real (non-demo) scan in the first 3 days.
- **Conversion:** trial → paid; the reasons people give for not converting.
- **Usage:** real scans per shop per week; invoices created; health reports sent and approved.
- **Revenue for the shop:** rand value of quotes approved through the health report. This is the number to put on the marketing site.
- **Churn** and its reasons, asked in a short exit question when a subscription is cancelled.

## Risks

| Risk | Mitigation |
|---|---|
| Real cars behave differently from the simulator | Phase 0 testing; terminal logs make fixes quick. |
| Cheap clone adapters give bad results, and users blame the app | Recommend specific adapters; sell or bundle a tested one; detect clones from `ATI`/`STI` replies and warn. |
| Large scan-tool brands compete on data | Compete on the workflow (scan → report → approval → invoice → payment) and local fit (ZAR, PayFast, WhatsApp, POPIA), not on data depth. |
| One developer and one server | Backups, monitoring, simple ops; the scheduler already supports multiple instances. |
| Legal exposure from wrong diagnostics | Clear limits in the UI and terms; no unvalidated manufacturer data; no bi-directional controls. |

## Suggested order, at a glance

1. Phase 0 (real-car test, legal, PayFast cycle, backups)
2. Bluetooth + PWA
3. Customer health report with quote approval
4. WhatsApp templates
5. Job card flow, VIN decode, onboarding
6. Accounting export, booking page, fleets
7. Licensed manufacturer data, only when there's revenue to pay for it
