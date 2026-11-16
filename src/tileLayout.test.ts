import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestTile, tileAt, tileGrid } from './tileLayout';

const layout = { width: 2112, height: 1901, across: 3, down: 5 };
const image = { width: 6336, height: 9504 };

test('spreads tiles evenly to the image edges', () => {
  const grid = tileGrid(image, layout, false);
  assert.deepEqual(tileAt(grid, 0, 0), {
    col: 0,
    row: 0,
    left: 0,
    top: 0.5,
    right: 2112,
    bottom: 1901.5,
  });
  const last = tileAt(grid, 2, 4);
  assert.equal(last.right, 6336);
  assert.ok(Math.abs(last.bottom - 9504) <= 0.5);
});

test('swaps the layout for an image rotated against the survey', () => {
  const grid = tileGrid({ width: 9504, height: 6336 }, layout, false);
  assert.equal(grid.across, 5);
  assert.equal(grid.down, 3);
  assert.equal(grid.width, 1901);
});

test('picks the tile centred nearest a point', () => {
  const grid = tileGrid(image, layout, false);
  const tile = nearestTile(grid, 3000, 4600);
  assert.deepEqual([tile.col, tile.row], [1, 2]);
  const corner = nearestTile(grid, -50, 99999);
  assert.deepEqual([corner.col, corner.row], [0, 4]);
});

test('handles huge grids without enumerating tiles', () => {
  const grid = tileGrid(
    image,
    { width: 1, height: 1, across: 6336, down: 9504 },
    false,
  );
  const tile = nearestTile(grid, 3000.2, 4600.7);
  assert.deepEqual([tile.col, tile.row], [3000, 4600]);
});
