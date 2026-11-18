import assert from 'node:assert/strict';
import test from 'node:test';
import { growTestBox, tileSizeForImage, type Box } from './testTileBounds';

const image = { width: 6000, height: 4000 };
const tile = { width: 1024, height: 768 };

function edges(box: Box) {
  return {
    left: box.x - box.width / 2,
    right: box.x + box.width / 2,
    top: box.y - box.height / 2,
    bottom: box.y + box.height / 2,
  };
}

function contains(outer: Box, inner: Box) {
  const o = edges(outer);
  const i = edges(inner);
  return (
    o.left <= i.left &&
    o.right >= i.right &&
    o.top <= i.top &&
    o.bottom >= i.bottom
  );
}

test('grows the test box to the tile size and keeps it inside', () => {
  const box = { x: 3000, y: 2000, width: 60, height: 40 };
  const grown = growTestBox(box, tile, image, 'loc-1')!;
  assert.equal(grown.width, 1024);
  assert.equal(grown.height, 768);
  assert.ok(contains(grown, box));
  const e = edges(grown);
  assert.ok(e.left >= 0 && e.top >= 0);
  assert.ok(e.right <= image.width && e.bottom <= image.height);
});

test('is the same box every time for a location and tile size', () => {
  const box = { x: 3000, y: 2000, width: 60, height: 40 };
  assert.deepEqual(
    growTestBox(box, tile, image, 'loc-1'),
    growTestBox(box, tile, image, 'loc-1'),
  );
});

test('does not keep the animal centred', () => {
  const box = { x: 3000, y: 2000, width: 20, height: 20 };
  const offsets = Array.from({ length: 50 }, (_, i) => {
    const grown = growTestBox(box, tile, image, `loc-${i}`)!;
    assert.ok(contains(grown, box));
    return [grown.x - box.x, grown.y - box.y];
  });
  const xs = new Set(offsets.map(([dx]) => dx));
  const ys = new Set(offsets.map(([, dy]) => dy));
  assert.ok(xs.size > 40 && ys.size > 40);
  const meanAbs = (values: number[]) =>
    values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
  assert.ok(meanAbs(offsets.map(([dx]) => dx)) > 150);
  assert.ok(meanAbs(offsets.map(([, dy]) => dy)) > 100);
});

test('clamps to the image near its edges', () => {
  const box = { x: 10, y: 3990, width: 20, height: 20 };
  const grown = growTestBox(box, tile, image, 'edge')!;
  const e = edges(grown);
  assert.equal(e.left, 0);
  assert.equal(e.bottom, image.height);
  assert.ok(contains(grown, box));
});

test('a box hanging off the image only needs its visible part covered', () => {
  const box = { x: 0, y: 2000, width: 100, height: 100 };
  const grown = growTestBox(box, tile, image, 'off')!;
  assert.equal(edges(grown).left, 0);
});

test('rejects a test box larger than the tile', () => {
  assert.equal(
    growTestBox(
      { x: 3000, y: 2000, width: 1100, height: 40 },
      tile,
      image,
      'a',
    ),
    null,
  );
  assert.equal(
    growTestBox({ x: 3000, y: 2000, width: 40, height: 800 }, tile, image, 'a'),
    null,
  );
});

test('a tile box the size of the tile stays where it is', () => {
  const box = { x: 1000, y: 1000, width: 1024, height: 768 };
  assert.deepEqual(growTestBox(box, tile, image, 'same'), box);
});

test('a tile larger than the image starts at its edge like real tiles', () => {
  const small = { width: 900, height: 4000 };
  const grown = growTestBox(
    { x: 450, y: 2000, width: 50, height: 50 },
    tile,
    small,
    'wide',
  )!;
  assert.equal(edges(grown).left, 0);
  assert.equal(grown.width, 1024);
});

test('swaps the tile on images oriented unlike the sample', () => {
  const sample = { tile, image };
  assert.deepEqual(
    tileSizeForImage(sample, { width: 5000, height: 3000 }),
    tile,
  );
  assert.deepEqual(tileSizeForImage(sample, { width: 4000, height: 6000 }), {
    width: 768,
    height: 1024,
  });
});
