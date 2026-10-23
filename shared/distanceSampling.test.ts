import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDistanceInputs, perpendicularDistance } from './distanceSampling';

const W = 4000;
const H = 6000;
const nadir = { focalLengthMm: 50, sensorWidthMm: 36, tiltDegrees: 0 };
const dist = (
  y: number,
  imageWidth: number,
  imageHeight: number,
  altitudeAgl: number | null,
  camera: Parameters<typeof perpendicularDistance>[0]['camera']
) => perpendicularDistance({ y, imageWidth, imageHeight, altitudeAgl, camera });
const close = (actual: number | null, expected: number) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 1e-9,
    `${actual} != ${expected}`
  );

test('nadir camera scales pixel offset by ground sample distance', () => {
  close(dist(3000, W, H, 100, nadir), 0);
  close(dist(0, W, H, 100, nadir), 100 * (18 / 50));
  close(dist(6000, W, H, 100, nadir), 100 * (18 / 50));
  close(dist(1500, W, H, 100, nadir), 100 * (9 / 50));
});

test('tilted camera has its far edge at the top of the image', () => {
  const halfFov = Math.atan(18 / 50);
  const tilt = { ...nadir, tiltDegrees: 30 };
  const t = Math.PI / 6;
  close(dist(3000, W, H, 100, tilt), 100 * Math.tan(t));
  close(dist(0, W, H, 100, tilt), 100 * Math.tan(t + halfFov));
  close(
    dist(6000, W, H, 100, tilt),
    100 * Math.tan(t - halfFov)
  );
});

test('tilt sign is ignored', () => {
  close(
    dist(1000, W, H, 100, { ...nadir, tiltDegrees: -30 })!,
    dist(1000, W, H, 100, { ...nadir, tiltDegrees: 30 })!
  );
});

test('pixel pitch uses the long side whichever way the image is stored', () => {
  const tilt = { ...nadir, tiltDegrees: 30 };
  close(
    dist(0, W, H, 100, tilt)!,
    100 * Math.tan(Math.PI / 6 + Math.atan(18 / 50))
  );
  close(
    dist(0, H, W, 100, tilt)!,
    100 * Math.tan(Math.PI / 6 + Math.atan(12 / 50))
  );
});

test('every camera spec and the altitude are required', () => {
  const inputs = { y: 10, imageWidth: W, imageHeight: H, altitudeAgl: 100, camera: nadir };
  assert.equal(hasDistanceInputs(inputs), true);
  assert.equal(hasDistanceInputs({ ...inputs, altitudeAgl: null }), false);
  assert.equal(hasDistanceInputs({ ...inputs, camera: undefined }), false);
  for (const key of ['focalLengthMm', 'sensorWidthMm', 'tiltDegrees'] as const) {
    assert.equal(
      hasDistanceInputs({ ...inputs, camera: { ...nadir, [key]: null } }),
      false
    );
  }
});

test('missing inputs or rays above the horizon give null', () => {
  assert.equal(dist(10, W, H, null, nadir), null);
  assert.equal(dist(10, W, H, 100, null), null);
  assert.equal(
    dist(10, W, H, 100, { ...nadir, focalLengthMm: null }),
    null
  );
  assert.equal(
    dist(0, W, H, 100, { ...nadir, tiltDegrees: 80 }),
    null
  );
});
