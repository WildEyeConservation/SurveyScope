import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyHomography,
  chainOtherCount,
  invertHomography,
  nearbyViews,
  timeOffsetLabel,
} from './otherViews';

const shift = (dx: number, dy: number) => [1, 0, dx, 0, 1, dy, 0, 0, 1];
const size = () => ({ width: 100, height: 100 });

test('applies a homography with perspective division', () => {
  assert.deepEqual(applyHomography(shift(5, -3), 10, 10), { x: 15, y: 7 });
  assert.deepEqual(applyHomography([2, 0, 0, 0, 2, 0, 0, 0, 2], 3, 4), {
    x: 3,
    y: 4,
  });
  assert.equal(applyHomography([1, 0, 0, 0, 1, 0, 0, 0, 0], 1, 1), null);
});

test('inverts a homography', () => {
  const h = [1.1, 0.05, 12, -0.02, 0.97, -8, 0.0001, 0.00002, 1];
  const inv = invertHomography(h)!;
  const p = applyHomography(h, 40, 70)!;
  const back = applyHomography(inv, p.x, p.y)!;
  assert.ok(Math.abs(back.x - 40) < 1e-9);
  assert.ok(Math.abs(back.y - 70) < 1e-9);
  assert.equal(invertHomography([0, 0, 0, 0, 0, 0, 0, 0, 0]), null);
});

test('projects forwards into image2 and backwards into image1', () => {
  const views = nearbyViews(
    'b',
    { x: 50, y: 50 },
    [
      { image1Id: 'a', image2Id: 'b', homography: shift(10, 0) },
      { image1Id: 'b', image2Id: 'c', homography: shift(-20, 5) },
    ],
    size,
  );
  assert.deepEqual(views, [
    { imageId: 'a', point: { x: 40, y: 50 } },
    { imageId: 'c', point: { x: 30, y: 55 } },
  ]);
});

test('drops neighbours the point projects outside of', () => {
  const views = nearbyViews(
    'a',
    { x: 90, y: 50 },
    [{ image1Id: 'a', image2Id: 'b', homography: shift(20, 0) }],
    size,
  );
  assert.deepEqual(views, []);
});

test('keeps neighbours without a registration, with no point', () => {
  const views = nearbyViews(
    'a',
    { x: 10, y: 10 },
    [
      { image1Id: 'a', image2Id: 'b', homography: null },
      { image1Id: 'c', image2Id: 'a', homography: [1, 2, 3] },
      { image1Id: 'x', image2Id: 'y', homography: shift(0, 0) },
    ],
    size,
  );
  assert.deepEqual(views, [
    { imageId: 'b', point: null },
    { imageId: 'c', point: null },
  ]);
});

test('prefers a projection over a missing registration for the same image', () => {
  const views = nearbyViews(
    'a',
    { x: 10, y: 10 },
    [
      { image1Id: 'b', image2Id: 'a', homography: null },
      { image1Id: 'a', image2Id: 'b', homography: shift(1, 1) },
    ],
    size,
  );
  assert.deepEqual(views, [{ imageId: 'b', point: { x: 11, y: 11 } }]);
});

test('counts the other members of a chain', () => {
  const rows = [
    { id: '1', objectId: '1' },
    { id: '2', objectId: '1' },
    { id: '3', objectId: '1' },
    { id: '4', objectId: null },
  ];
  assert.equal(chainOtherCount(rows, '1', '2'), 2);
  assert.equal(chainOtherCount(rows, null, '4'), 0);
});

test('labels time offsets', () => {
  assert.equal(timeOffsetLabel(2.2, false), '+2 s');
  assert.equal(timeOffsetLabel(-4, false), '−4 s');
  assert.equal(timeOffsetLabel(75, false), '+1 m 15 s');
  assert.equal(timeOffsetLabel(3, true), 'This image');
  assert.equal(timeOffsetLabel(null, false), '');
});
