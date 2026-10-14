import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countMaskRegions,
  isPointMasked,
  pairCameraMasks,
  parseCameraMasks,
  serializeCameraMasks,
} from './CameraMask';

const corner: [number, number][] = [
  [0.5, 0.5],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
];

test('parses stored JSON and drops malformed polygons', () => {
  const parsed = parseCameraMasks(
    JSON.stringify({ landscape: [corner, [[0, 0]]], portrait: 'nope' })
  );
  assert.deepEqual(parsed, { landscape: [corner] });
  assert.equal(countMaskRegions(parsed), 1);
  assert.deepEqual(parseCameraMasks('not json'), {});
});

test('serializes empty masks as null', () => {
  assert.equal(serializeCameraMasks({}), null);
  assert.equal(serializeCameraMasks({ landscape: [] }), null);
  assert.equal(
    serializeCameraMasks({ landscape: [corner] }),
    JSON.stringify({ landscape: [corner] })
  );
});

test('masks points by the stored image shape', () => {
  const masks = { landscape: [corner] };
  assert.equal(isPointMasked(masks, 3000, 1500, 4000, 2000), true);
  assert.equal(isPointMasked(masks, 1000, 1500, 4000, 2000), false);
  assert.equal(isPointMasked(masks, 1500, 3000, 2000, 4000), false);
});

test('pairs masks positionally for a registration pair', () => {
  const masksByCamera = new Map([['cam-b', { landscape: [corner] }]]);
  assert.deepEqual(pairCameraMasks(['cam-a', 'cam-b'], masksByCamera), [
    null,
    { landscape: [corner] },
  ]);
  assert.equal(pairCameraMasks(['cam-a', null], masksByCamera), undefined);
});
