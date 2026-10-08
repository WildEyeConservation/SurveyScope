import assert from 'node:assert/strict';
import test from 'node:test';
import { getBaselineBearing } from './baselineBearing';

type Point = { longitude: number; latitude: number; transectId: number };

function line(
  transectId: number,
  from: [number, number],
  to: [number, number]
): Point[] {
  return [
    { transectId, longitude: from[0], latitude: from[1] },
    { transectId, longitude: to[0], latitude: to[1] },
  ];
}

// bearings 0 and 180 describe the same baseline axis
function axisOffset(bearing: number, expected: number): number {
  const diff = (((bearing - expected) % 180) + 180) % 180;
  return Math.min(diff, 180 - diff);
}

test('lines flown alternately north and south give an east-west baseline', () => {
  const images = [
    ...line(0, [20.0, -25], [20.0, -24]),
    ...line(1, [20.1, -24], [20.1, -25]),
    ...line(2, [20.2, -25], [20.2, -24]),
    ...line(3, [20.3, -24], [20.3, -25]),
  ];
  assert.ok(axisOffset(getBaselineBearing([0, 1, 2, 3], images), 90) < 1);
});

test('an uneven mix of directions still gives an east-west baseline', () => {
  const images = [
    ...line(0, [20.0, -25], [20.0, -24]),
    ...line(1, [20.1, -24.01], [20.1, -25]),
    ...line(2, [20.2, -25], [20.21, -24]),
  ];
  assert.ok(axisOffset(getBaselineBearing([0, 1, 2], images), 90) < 1);
});

test('lines flown alternately east and west give a north-south baseline', () => {
  const images = [
    ...line(0, [20, -24.0], [21, -24.0]),
    ...line(1, [21, -24.1], [20, -24.1]),
  ];
  assert.ok(axisOffset(getBaselineBearing([0, 1], images), 0) < 1);
});

test('lines flown in one direction keep their baseline', () => {
  const images = [
    ...line(0, [20.0, -25], [20.0, -24]),
    ...line(1, [20.1, -25], [20.1, -24]),
  ];
  assert.ok(axisOffset(getBaselineBearing([0, 1], images), 90) < 1);
});

test('transects with fewer than two images are ignored', () => {
  const images = [
    ...line(0, [20, -24.0], [21, -24.0]),
    { transectId: 1, longitude: 20, latitude: -25 },
  ];
  assert.ok(axisOffset(getBaselineBearing([0, 1], images), 0) < 1);
});
