import test from 'node:test';
import assert from 'node:assert/strict';
import { viewTiles } from './viewTiles';

const image = { width: 6336, height: 9504 };

test('queue zoom 6 shows full resolution tiles around the location', () => {
  const tiles = viewTiles({
    image,
    location: { x: 3000, y: 5000, width: 64, height: 64 },
    zoom: 6,
    viewport: { width: 1024, height: 512 },
  });
  // 1:1 pixels: 1024x512 around (3000, 5000) spans columns 9-13, rows 18-20.
  assert.ok(tiles.every((t) => t.z === 6));
  assert.deepEqual(
    [...new Set(tiles.map((t) => t.col))],
    [9, 10, 11, 12, 13]
  );
  assert.deepEqual([...new Set(tiles.map((t) => t.row))], [18, 19, 20]);
});

test('clips to the image edge', () => {
  const tiles = viewTiles({
    image,
    location: { x: 10, y: 10, width: 64, height: 64 },
    zoom: 6,
    viewport: { width: 1024, height: 512 },
  });
  assert.equal(Math.min(...tiles.map((t) => t.col)), 0);
  assert.equal(Math.min(...tiles.map((t) => t.row)), 0);
  // Half the view (512 x 256 px) reaches columns 0-2 and rows 0-1.
  assert.equal(Math.max(...tiles.map((t) => t.col)), 2);
  assert.equal(Math.max(...tiles.map((t) => t.row)), 1);
  assert.equal(tiles.length, 6);
});

test('without a zoom, fits the location box at 1.5x', () => {
  const tiles = viewTiles({
    image,
    location: { x: 3000, y: 5000, width: 64, height: 64 },
    zoom: null,
    viewport: { width: 800, height: 800 },
  });
  // 800 / 192 px is about 4x, beyond full resolution, so level 6 is used.
  assert.ok(tiles.length > 0 && tiles.length <= 4);
  assert.ok(tiles.every((t) => t.z === 6));
});
