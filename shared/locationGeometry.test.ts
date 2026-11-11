import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isCentreObserved,
  isPointInBox,
  isTileSeen,
} from './locationGeometry.ts';

const observed = { x: 100, y: 100, width: 40, height: 20 };

test('isPointInBox includes the edges', () => {
  assert.equal(isPointInBox(120, 110, observed), true);
  assert.equal(isPointInBox(80, 90, observed), true);
  assert.equal(isPointInBox(121, 100, observed), false);
  assert.equal(isPointInBox(100, 111, observed), false);
});

test('a box is observed only when its centre is inside an observed box', () => {
  assert.equal(
    isCentreObserved({ x: 115, y: 105, width: 200, height: 200 }, [observed]),
    true,
  );
  assert.equal(
    isCentreObserved({ x: 130, y: 100, width: 40, height: 40 }, [observed]),
    false,
  );
  assert.equal(
    isCentreObserved({ x: 100, y: 100, width: 10, height: 10 }, []),
    false,
  );
});

test('a tile is seen when a reviewed detection touches it', () => {
  const tile = { x: 1000, y: 1000, width: 2000, height: 2000 };
  const detection = (x: number, y: number) => ({ x, y, width: 64, height: 64 });
  assert.equal(isTileSeen(tile, [detection(300, 1700)]), true);
  // Centred just outside, but its box reaches over the edge.
  assert.equal(isTileSeen(tile, [detection(2020, 1000)]), true);
  assert.equal(isTileSeen(tile, [detection(2040, 1000)]), false);
  assert.equal(isTileSeen(tile, []), false);
});

test('a reviewed tile only covers tiles centred in it', () => {
  const tile = { x: 1000, y: 1000, width: 2000, height: 2000 };
  const reviewedTile = (x: number) => ({
    x,
    y: 1000,
    width: 2000,
    height: 2000,
  });
  assert.equal(isTileSeen(tile, [reviewedTile(1000)]), true);
  // An overlapping neighbour shares only a strip.
  assert.equal(isTileSeen(tile, [reviewedTile(2800)]), false);
});
