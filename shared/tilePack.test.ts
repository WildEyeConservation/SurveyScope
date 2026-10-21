import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { maxTileZoom, validTile } from './imageTiles.ts';
import {
  decodeHeader,
  encodeHeader,
  maxZoomFor,
  pyramid,
  tileIndex,
} from './tilePack.ts';

test('pyramid matches the slippymap grid', () => {
  const image = { width: 10000, height: 6000 };
  const maxZoom = maxZoomFor(image.width, image.height, 256);
  assert.equal(maxZoom, maxTileZoom(image));
  const { levels, tileCount } = pyramid({ ...image, tileSize: 256, maxZoom });
  assert.deepEqual(
    levels.map((level) => level.columns * level.rows),
    [1, 2, 6, 15, 60, 240, 960]
  );
  assert.equal(tileCount, 1284);
  for (const level of levels) {
    const last = { z: level.zoom, row: level.rows - 1, col: level.columns - 1 };
    assert.ok(validTile(last, image));
    assert.ok(!validTile({ ...last, row: level.rows }, image));
    assert.ok(!validTile({ ...last, col: level.columns }, image));
  }
  assert.equal(maxZoomFor(200, 100, 256), 0);
});

test('locates tiles and refuses coordinates outside the image', () => {
  const meta = {
    width: 1000,
    height: 600,
    tileSize: 256,
    maxZoom: maxZoomFor(1000, 600, 256),
  };
  const { levels } = pyramid(meta);
  assert.equal(tileIndex(levels, 0, 0, 0), 0);
  assert.equal(tileIndex(levels, 2, 2, 3), levels[2].start + 2 * 4 + 3);
  assert.equal(tileIndex(levels, 2, 3, 0), undefined);
  assert.equal(tileIndex(levels, 2, 0, 4), undefined);
  assert.equal(tileIndex(levels, 3, 0, 0), undefined);
  assert.equal(tileIndex(levels, 1, -1, 0), undefined);
  assert.equal(tileIndex(levels, 1, 0.5, 0), undefined);
});

test('round-trips a header and reports how many bytes it still needs', () => {
  const meta = {
    width: 600,
    height: 300,
    tileSize: 256,
    maxZoom: 2,
    format: 'image/webp',
  };
  const lengths = Array.from(
    { length: pyramid(meta).tileCount },
    (_, index) => 100 + index
  );
  const header = encodeHeader(meta, lengths);
  const decoded = decodeHeader(header);
  assert.ok(decoded.complete);
  assert.deepEqual(decoded.meta, meta);
  assert.equal(decoded.entries[0].offset, header.length);
  assert.equal(decoded.entries[1].offset, header.length + 100);
  assert.deepEqual(
    decoded.entries.map((entry) => entry.length),
    lengths
  );
  assert.deepEqual(decodeHeader(header.subarray(0, header.length - 1)), {
    complete: false,
    needed: header.length,
  });
  assert.equal(decodeHeader(header.subarray(0, 4)).complete, false);
});

test('rejects the wrong number of tiles and foreign files', () => {
  const meta = {
    width: 600,
    height: 300,
    tileSize: 256,
    maxZoom: 2,
    format: 'image/webp',
  };
  assert.throws(() => encodeHeader(meta, [1, 2, 3]));
  assert.throws(() =>
    decodeHeader(
      Uint8Array.from('definitely not a tile pack', (c) => c.charCodeAt(0))
    )
  );
});
