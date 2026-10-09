const test = require('node:test');
const assert = require('node:assert/strict');
const cars = require('../src/data/cars');

test('car database: large, no duplicate models per make, key SA-market models present', () => {
  const makes = Object.keys(cars);
  assert.ok(makes.length >= 120);
  assert.ok(makes.reduce((n, m) => n + cars[m].length, 0) >= 2000);
  for (const m of makes) {
    const lower = cars[m].map((x) => x.toLowerCase());
    assert.equal(new Set(lower).size, lower.length, `duplicate model in ${m}`);
  }
  assert.ok(cars.Volkswagen.includes('Polo Vivo') && cars.Toyota.includes('Hilux') && cars.Ford.includes('Ranger'));
});

test('fault-code library: generic J2012 patterns fill gaps, curated entries win, manufacturer codes stay unknown', () => {
  const { lookup, all } = require('../src/lib/dtc');
  assert.equal(lookup('P0305').name, 'Cylinder 5 misfire detected');
  assert.equal(lookup('P0305').sev, 'critical');
  assert.equal(lookup('P0207').name, 'Injector circuit malfunction — cylinder 7');
  assert.equal(lookup('P0267').name, 'Cylinder 3 injector circuit low');
  assert.equal(lookup('P0296').name, 'Cylinder 12 injector contribution/balance fault');
  assert.match(lookup('P0158').name, /high voltage \(bank 2 sensor 2\)/);
  assert.match(lookup('P0117').name, /coolant temperature sensor circuit low input/i);
  assert.equal(lookup('P0430').name, 'Catalyst system efficiency below threshold (bank 2)');
  assert.equal(lookup('U0121').sys, 'Network');
  const curated = require('../src/data/dtcs').find((d) => d.code === 'P0171');
  assert.equal(lookup('P0171').tip, curated.tip, 'curated workshop tip wins');
  assert.equal(lookup('P1234').known, false);
  assert.equal(lookup('P0999').known, false, 'no made-up meaning for codes outside the patterns');
  const list = all();
  assert.ok(list.length >= 190);
  assert.equal(new Set(list.map((d) => d.code)).size, list.length, 'no duplicates');
});

test('PID reference: every standard PID has a decoder and a reply length, and vice versa', () => {
  const pids = require('../src/data/pids');
  const ELM327 = require('../public/elm327.js');
  const std = pids.filter((p) => p.verified).map((p) => p.pid.slice(2));
  assert.deepEqual([...std].sort(), Object.keys(ELM327.DECODE).sort());
  for (const p of std) assert.ok(ELM327.BYTES[p] >= 1, `reply length for ${p}`);
  assert.equal(new Set(pids.map((p) => p.pid)).size, pids.length);
});
