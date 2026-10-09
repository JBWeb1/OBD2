# Real-car test plan (do this before selling)

The ELM327 driver is unit-tested against a simulated adapter only. Real adapters and ECUs differ, so run this on **at least 5 different vehicles and 2 adapters** and record results in a sheet.

## Equipment
- A genuine ELM327 or OBDLink-class USB adapter (cheap v2.1 clones often fail, drop connection, or fake commands) — test one clone too so you know how they behave.
- Computer with Chrome or Edge. Car battery healthy (voltage matters), ignition ON, engine off for the first pass, then running.

## Vehicles to cover (minimum)
1. A 2008+ CAN car (e.g. VW/Audi, Toyota, Ford) — ISO 15765-4
2. A 2004–2008 car (mixed CAN/K-line)
3. A pre-2004 EU car (ISO 9141 / KWP 2000) if you can find one
4. A diesel (checks the diesel readiness monitor mapping)
5. A car with a stored fault (pull a sensor connector to create one — only on a car you own)

## Checklist per vehicle
| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Connect with "Auto-detect" | Connects, protocol name shown, no timeout | |
| 2 | Connect with the specific protocol | Same | |
| 3 | Read VIN | 17 chars, matches the car's plate/registration papers | |
| 4 | Live scan 60 s, engine idling | Gauges update; RPM ≈ idle, coolant plausible, battery 12–14.5 V | |
| 5 | Rev engine | RPM, throttle, load respond immediately | |
| 6 | Compare against another scan tool | Values within normal tolerance | |
| 7 | Read stored + pending codes | Matches the other tool | |
| 8 | Readiness & MIL | MIL state matches the dashboard; monitors plausible | |
| 9 | Freeze frame | DTC and values plausible (or "none stored") | |
| 10 | Clear codes (car you own!) | Codes gone, MIL off, monitors "not ready" | |
| 11 | Unplug adapter mid-scan | App shows an error, doesn't hang | |
| 12 | Leave scanning 10 min | No memory growth/freeze; sample rate stable | |

## What to log when something fails
Use **Terminal → ⬇ Save log** — it saves the exact commands and replies. Send that file plus the car (make/model/year/engine) and adapter. Most bugs are response-format differences that are quick to fix once you have the log.

## Known limits
- Polling speed is limited by the adapter (typically 5–15 PID reads/second). Many PIDs make each gauge update slower.
- Only standard J1979 PIDs are decoded. Manufacturer-specific data (VAG, BMW, etc.) is **not** implemented.
- Do not market bi-directional controls, coding, adaptations, resets or special functions. They need protocols and data this app does not have.
