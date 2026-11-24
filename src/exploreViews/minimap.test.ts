import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundsOf,
  fitView,
  flightDirection,
  fromScreen,
  meanCosLat,
  nearestWithin,
  ringToPlane,
  toPlane,
  toScreen,
  zoomAt,
} from './minimap';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('projects north-up with longitude scaled by latitude', () => {
  const cos = meanCosLat([60, 60]);
  assert.ok(near(cos, 0.5));
  const plane = toPlane([60, 61], [10, 10], cos);
  assert.ok(near(plane.xs[0], 5) && near(plane.xs[1], 5));
  assert.ok(plane.ys[1] < plane.ys[0], 'north is up');
});

test('reads stored outlines as lat, lng pairs', () => {
  assert.deepEqual(ringToPlane([1, 10, 2, 20, 3, 30], 1), [
    [10, -1],
    [20, -2],
    [30, -3],
  ]);
  assert.equal(ringToPlane([1, 2, 3, 4], 1), null);
});

test('fits bounds into the canvas, centred and aspect preserved', () => {
  const v = fitView({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 120, 120, 10);
  assert.ok(near(v.scale, 10));
  assert.deepEqual(toScreen(v, 0, 0), [10, 35]);
  assert.deepEqual(toScreen(v, 10, 5), [110, 85]);
  const [x, y] = fromScreen(v, 60, 60);
  assert.ok(near(x, 5) && near(y, 2.5));
});

test('a single point still gets a finite view', () => {
  const v = fitView({ minX: 3, minY: 3, maxX: 3, maxY: 3 }, 100, 100, 0, 2);
  assert.ok(near(v.scale, 50));
  assert.deepEqual(toScreen(v, 3, 3), [50, 50]);
});

test('zooming keeps the point under the cursor fixed', () => {
  const v = { scale: 2, tx: 5, ty: -3 };
  const before = fromScreen(v, 40, 30);
  const after = fromScreen(zoomAt(v, 40, 30, 1.7), 40, 30);
  assert.ok(near(before[0], after[0]) && near(before[1], after[1]));
});

test('bounds cover points and outlines', () => {
  const plane = toPlane([0, 1], [0, 2], 1);
  assert.deepEqual(boundsOf(plane, [0, 1], [[[5, 5]]]), {
    minX: 0,
    minY: -1,
    maxX: 5,
    maxY: 5,
  });
  assert.deepEqual(boundsOf(plane, [1]), {
    minX: 2,
    minY: -1,
    maxX: 2,
    maxY: -1,
  });
});

test('hit testing snaps to the nearest candidate within the radius', () => {
  const plane = {
    xs: Float64Array.from([0, 10, 12]),
    ys: Float64Array.from([0, 0, 0]),
  };
  const v = { scale: 1, tx: 0, ty: 0 };
  assert.equal(nearestWithin(plane, [0, 1, 2], v, 11.5, 1, 8), 2);
  assert.equal(nearestWithin(plane, [0, 1], v, 11.5, 1, 8), 1);
  assert.equal(nearestWithin(plane, [0, 1, 2], v, 30, 0, 8), -1);
  assert.equal(nearestWithin(plane, [], v, 0, 0, 8), -1);
});

test('hit radius is in screen pixels regardless of zoom', () => {
  const plane = { xs: Float64Array.from([1]), ys: Float64Array.from([0]) };
  assert.equal(
    nearestWithin(plane, [0], { scale: 4, tx: 0, ty: 0 }, 0, 0, 8),
    0,
  );
  assert.equal(
    nearestWithin(plane, [0], { scale: 10, tx: 0, ty: 0 }, 0, 0, 8),
    -1,
  );
});

test('flight direction follows the time neighbours', () => {
  const plane = {
    xs: Float64Array.from([0, 1, 2]),
    ys: Float64Array.from([0, 0, 0]),
  };
  assert.deepEqual(flightDirection(plane, 0, 1, 2), [1, 0]);
  const back = flightDirection(plane, -1, 1, 0)!;
  assert.ok(near(back[0], -1) && near(back[1], 0));
  assert.equal(flightDirection(plane, -1, 1, -1), null);
});
