import test from 'node:test';
import assert from 'node:assert/strict';
import {
  altitudeBandFrom,
  computeAglByRow,
  isOutsideAltitudeBand,
} from './altitudeFilter';

test('altitudeBandFrom builds a band in meters', () => {
  assert.deepEqual(altitudeBandFrom('100', '20', 'm'), { min: 80, max: 120 });
  const ft = altitudeBandFrom('300', '50', 'ft')!;
  assert.ok(Math.abs(ft.min - 76.2) < 1e-9);
  assert.ok(Math.abs(ft.max - 106.68) < 1e-9);
});

test('altitudeBandFrom rejects incomplete or invalid input', () => {
  assert.equal(altitudeBandFrom('', '20', 'm'), null);
  assert.equal(altitudeBandFrom('100', '', 'm'), null);
  assert.equal(altitudeBandFrom('abc', '20', 'm'), null);
  assert.equal(altitudeBandFrom('0', '20', 'm'), null);
  assert.equal(altitudeBandFrom('100', '-1', 'm'), null);
});

test('isOutsideAltitudeBand keeps unknown heights and band edges', () => {
  const band = { min: 80, max: 120 };
  assert.equal(isOutsideAltitudeBand(undefined, band), false);
  assert.equal(isOutsideAltitudeBand(80, band), false);
  assert.equal(isOutsideAltitudeBand(120, band), false);
  assert.equal(isOutsideAltitudeBand(79.9, band), true);
  assert.equal(isOutsideAltitudeBand(120.1, band), true);
});

test('computeAglByRow subtracts ground elevation', async () => {
  const rows = [
    { lat: -24.5, lng: 31.5, alt: 500 },
    { lat: -24.6, lng: 31.6, alt: NaN },
    { lat: -24.7, lng: 31.7, alt: 0 },
    { lat: -24.8, lng: 31.8, alt: 450 },
  ];
  const ground = new Map([
    [rows[0], 400],
    [rows[3], -32768],
  ]);
  const agl = await computeAglByRow(
    rows,
    false,
    async (lat) => ground.get(rows.find((r) => r.lat === lat)!) ?? null
  );
  assert.equal(agl.get(rows[0]), 100);
  assert.equal(agl.size, 1);
});

test('computeAglByRow uses AGL altitudes without a lookup', async () => {
  const rows = [{ lat: 1, lng: 1, alt: 90 }];
  const agl = await computeAglByRow(rows, true, async () => {
    throw new Error('should not look up');
  });
  assert.equal(agl.get(rows[0]), 90);
});

test('an explicit AGL of 0 is a known height outside a positive band', async () => {
  const rows = [{ lat: 1, lng: 1, alt: 0 }];
  const agl = await computeAglByRow(rows, true, async () => null);
  assert.equal(agl.get(rows[0]), 0);
  assert.equal(
    isOutsideAltitudeBand(agl.get(rows[0]), { min: 80, max: 120 }),
    true
  );
});

test('computeAglByRow stops retrying a tile after a failed lookup', async () => {
  const rows = [
    { lat: 0.1, lng: 0.1, alt: 100 },
    { lat: 0.2, lng: 0.2, alt: 100 },
    { lat: 1.1, lng: 0.1, alt: 100 },
  ];
  let calls = 0;
  const agl = await computeAglByRow(rows, false, async (lat) => {
    calls++;
    return lat < 1 ? null : 40;
  });
  assert.equal(calls, 2);
  assert.equal(agl.get(rows[2]), 60);
  assert.equal(agl.size, 1);
});
