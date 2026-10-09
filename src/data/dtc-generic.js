// Generic SAE J2012 code meanings, generated from the standard's numbering patterns.
// These are the generic (P0xxx / P2xxx / U0xxx) definitions every OBD2 car shares. They fill gaps in the curated
// list in dtcs.js (which has workshop tips and wins on conflicts). Manufacturer codes (P1xxx etc.) are not covered.
const SENSOR_SUFFIX = ['circuit malfunction', 'circuit range/performance', 'circuit low input', 'circuit high input', 'circuit intermittent'];
const O2_SUFFIX = ['circuit malfunction', 'circuit low voltage', 'circuit high voltage', 'circuit slow response', 'circuit no activity detected', 'heater circuit malfunction'];
const O2_SENSORS = [[130, 'bank 1 sensor 1'], [136, 'bank 1 sensor 2'], [142, 'bank 1 sensor 3'], [150, 'bank 2 sensor 1'], [156, 'bank 2 sensor 2'], [162, 'bank 2 sensor 3']];

const W = 'warning', C = 'critical', A = 'advisory';
const fixed = {
  P0011: ['Camshaft position A — timing over-advanced (bank 1)', 'Timing', W], P0012: ['Camshaft position A — timing over-retarded (bank 1)', 'Timing', W],
  P0016: ['Crankshaft / camshaft position correlation (bank 1 sensor A)', 'Timing', C], P0017: ['Crankshaft / camshaft position correlation (bank 1 sensor B)', 'Timing', C],
  P0125: ['Insufficient coolant temperature for closed-loop fuel control', 'Cooling', A], P0128: ['Coolant thermostat — temperature below regulating temperature', 'Cooling', A],
  P0171: ['System too lean — bank 1', 'Fuel', W], P0172: ['System too rich — bank 1', 'Fuel', W],
  P0174: ['System too lean — bank 2', 'Fuel', W], P0175: ['System too rich — bank 2', 'Fuel', W],
  P0234: ['Turbocharger / supercharger overboost condition', 'Boost', C], P0299: ['Turbocharger / supercharger underboost', 'Boost', W],
  P0300: ['Random / multiple cylinder misfire detected', 'Misfire', C],
  P0325: ['Knock sensor 1 circuit malfunction (bank 1)', 'Ignition', W], P0330: ['Knock sensor 2 circuit malfunction (bank 2)', 'Ignition', W],
  P0335: ['Crankshaft position sensor A circuit malfunction', 'Ignition', C], P0336: ['Crankshaft position sensor A circuit range/performance', 'Ignition', C],
  P0340: ['Camshaft position sensor A circuit malfunction (bank 1)', 'Ignition', W], P0341: ['Camshaft position sensor A circuit range/performance (bank 1)', 'Ignition', W],
  P0400: ['EGR flow malfunction', 'EGR', W], P0401: ['EGR flow insufficient detected', 'EGR', W], P0402: ['EGR flow excessive detected', 'EGR', W],
  P0420: ['Catalyst system efficiency below threshold (bank 1)', 'Emissions', W], P0421: ['Warm-up catalyst efficiency below threshold (bank 1)', 'Emissions', W],
  P0430: ['Catalyst system efficiency below threshold (bank 2)', 'Emissions', W], P0431: ['Warm-up catalyst efficiency below threshold (bank 2)', 'Emissions', W],
  P0440: ['Evaporative emission system malfunction', 'EVAP', A], P0441: ['Evaporative emission system incorrect purge flow', 'EVAP', A],
  P0442: ['Evaporative emission system leak detected (small leak)', 'EVAP', A], P0446: ['Evaporative emission vent control circuit malfunction', 'EVAP', A],
  P0455: ['Evaporative emission system leak detected (large leak)', 'EVAP', A], P0456: ['Evaporative emission system leak detected (very small leak)', 'EVAP', A],
  P0500: ['Vehicle speed sensor malfunction', 'Speed', W], P0505: ['Idle air control system malfunction', 'Idle', W],
  P0506: ['Idle control system — RPM lower than expected', 'Idle', A], P0507: ['Idle control system — RPM higher than expected', 'Idle', A],
  P0560: ['System voltage malfunction', 'Electrical', W], P0562: ['System voltage low', 'Electrical', W], P0563: ['System voltage high', 'Electrical', W],
  P0600: ['Serial communication link malfunction', 'ECU', W], P0601: ['Internal control module memory checksum error', 'ECU', C],
  P0603: ['Internal control module keep-alive memory (KAM) error', 'ECU', W], P0605: ['Internal control module read-only memory (ROM) error', 'ECU', C],
  P0606: ['Control module processor fault', 'ECU', C],
  P0700: ['Transmission control system malfunction (TCM has a fault — read the TCM)', 'Transmission', W],
  P0705: ['Transmission range sensor circuit malfunction', 'Transmission', W], P0715: ['Input / turbine speed sensor circuit malfunction', 'Transmission', W],
  P0720: ['Output speed sensor circuit malfunction', 'Transmission', W], P0730: ['Incorrect gear ratio', 'Transmission', W],
  P0740: ['Torque converter clutch circuit malfunction', 'Transmission', W],
  P2002: ['Particulate filter efficiency below threshold (bank 1)', 'DPF', W], P2096: ['Post-catalyst fuel trim system too lean (bank 1)', 'Fuel', W],
  P2097: ['Post-catalyst fuel trim system too rich (bank 1)', 'Fuel', W], P2187: ['System too lean at idle (bank 1)', 'Fuel', W],
  P2188: ['System too rich at idle (bank 1)', 'Fuel', W], P2463: ['Particulate filter — soot accumulation', 'DPF', W],
  U0001: ['High-speed CAN communication bus', 'Network', W], U0100: ['Lost communication with ECM/PCM "A"', 'Network', C],
  U0101: ['Lost communication with TCM', 'Network', W], U0121: ['Lost communication with ABS control module', 'Network', W],
  U0140: ['Lost communication with body control module', 'Network', W], U0155: ['Lost communication with instrument panel cluster', 'Network', W],
};

function generic(code) {
  if (fixed[code]) { const [name, sys, sev] = fixed[code]; return { name, sys, sev }; }
  if (code[0] !== 'P' || code[1] !== '0') return null;
  const n = parseInt(code.slice(2), 10);
  if (Number.isNaN(n) || !/^\d{3}$/.test(code.slice(2))) return null;
  const sensors = [[100, 'Mass air flow (MAF)', 'MAF'], [105, 'Manifold absolute pressure (MAP) / barometric', 'MAP'], [110, 'Intake air temperature', 'Air'], [115, 'Engine coolant temperature', 'Cooling'], [120, 'Throttle / pedal position sensor A', 'Throttle']];
  for (const [base, label, sys] of sensors) if (n >= base && n < base + 5) return { name: `${label} sensor ${SENSOR_SUFFIX[n - base]}`, sys, sev: W };
  for (const [base, label] of O2_SENSORS) if (n >= base && n < base + 6) return { name: `O2 sensor ${O2_SUFFIX[n - base]} (${label})`, sys: 'O2 sensor', sev: n - base === 5 ? A : W };
  if (n >= 201 && n <= 212) return { name: `Injector circuit malfunction — cylinder ${n - 200}`, sys: 'Injector', sev: C };
  if (n >= 261 && n <= 296) {
    const cyl = Math.floor((n - 261) / 3) + 1; const kind = ['circuit low', 'circuit high', 'contribution/balance fault'][(n - 261) % 3];
    return { name: `Cylinder ${cyl} injector ${kind}`, sys: 'Injector', sev: W };
  }
  if (n >= 301 && n <= 312) return { name: `Cylinder ${n - 300} misfire detected`, sys: 'Misfire', sev: C };
  if (n >= 351 && n <= 362) return { name: `Ignition coil ${String.fromCharCode(64 + n - 350)} primary/secondary circuit malfunction (usually cylinder ${n - 350})`, sys: 'Ignition', sev: C };
  return null;
}

const TIPS = {
  Misfire: ['Worn spark plugs, failing coil or injector, vacuum leak, low compression', 'Swap the coil (or injector) with another cylinder and see if the misfire follows. Then plugs, then a compression test.'],
  Injector: ['Injector, wiring/connector, or ECU driver', 'Measure injector resistance and check the harness and connector for chafing or corrosion.'],
  Ignition: ['Sensor, coil, wiring or connector', 'Inspect the connector and wiring first; check the sensor/coil signal with a scope or multimeter.'],
  'O2 sensor': ['Ageing sensor, wiring, exhaust leak before the sensor, or fuel mixture fault', 'Check for exhaust leaks and wiring damage; compare sensor switching against the fuel trims.'],
  Network: ['Wiring, a module without power/ground, or a failed module', 'Check power and ground at the module that stopped talking, then the CAN wiring (about 60 Ω across CAN-H/CAN-L with ignition off).'],
};

function genericInfo(code) {
  const g = generic(code); if (!g) return null;
  const [cause, tip] = TIPS[g.sys] || ['See the manufacturer service data for this vehicle', 'Check wiring and connectors for the component first, then test the component itself.'];
  return { code, sys: g.sys, name: g.name, cause, tip, sev: g.sev, source: 'generic' };
}

module.exports = { genericInfo };
