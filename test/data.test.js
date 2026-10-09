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
