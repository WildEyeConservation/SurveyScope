import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bufferedTiles,
  tileId,
  validTile,
  MAX_TILE_BATCH,
  type TileCoordinate,
} from '../../shared/imageTiles';
import { TileUrlBatcher, type TileContext } from './tileUrlBatcher';
const image: TileContext = { imageId: 'image-a', width: 4096, height: 4096 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('one-tile border includes diagonals and parents, never children', () => {
  const visible = [];
  for (let row = 4; row < 7; row++)
    for (let col = 4; col < 8; col++) visible.push({ z: 4, row, col });
  const batch = bufferedTiles(visible, image);
  assert.equal(batch.filter((t) => t.z === 4).length, 30);
  assert.equal(batch.filter((t) => t.z === 3).length, 12);
  assert.deepEqual(new Set(batch.map((t) => t.z)), new Set([4, 3]));
  assert(batch.some((t) => tileId(t) === '4/3/3'));
});
test('clips to actual image bounds and handles zoom zero and small images', () => {
  const dimensions = { width: 600, height: 300 };
  assert(
    bufferedTiles([{ z: 2, row: 0, col: 0 }], dimensions).every((t) =>
      validTile(t, dimensions)
    )
  );
  assert.deepEqual(
    bufferedTiles([{ z: 0, row: 0, col: 0 }], { width: 100, height: 100 }),
    [{ z: 0, row: 0, col: 0 }]
  );
  for (const invalid of [
    { z: -1, row: 0, col: 0 },
    { z: 4.5, row: 0, col: 0 },
    { z: 4, row: 16, col: 0 },
  ])
    assert.equal(validTile(invalid, image), false);
});
test('coalesces concurrent tiles, reuses signed buffer and isolates identities', async () => {
  const batches: TileCoordinate[][] = [];
  const batcher = new TileUrlBatcher(async (_context, _key, tiles) => {
    batches.push(tiles);
    return {
      expiresAt: Date.now() + 3600000,
      tiles: tiles.map((t) => ({ ...t, url: tileId(t) })),
    };
  });
  const center = { z: 4, row: 5, col: 5 };
  const first = batcher.get('user-a', image, 'legacy/photo.jpg', center);
  const duplicate = batcher.get('user-a', image, 'legacy/photo.jpg', center);
  assert.equal(first, duplicate);
  await Promise.all([
    first,
    batcher.get('user-a', image, 'legacy/photo.jpg', { ...center, col: 6 }),
  ]);
  assert.equal(batches.length, 1);
  assert.equal(
    (await batcher.get('user-a', image, 'legacy/photo.jpg', center)).url,
    '4/5/5'
  );
  await tick();
  assert.equal(batches.length, 1);
  await batcher.get('user-b', image, 'legacy/photo.jpg', center);
  assert.equal(batches.length, 2);
});
test('refreshes near expiry and splits large viewports at the API bound', async () => {
  let now = 1000000;
  const batches: TileCoordinate[][] = [];
  const batcher = new TileUrlBatcher(
    async (_context, _key, tiles) => {
      batches.push(tiles);
      return {
        expiresAt: now + 3600000,
        tiles: tiles.map((t) => ({ ...t, url: 'url' })),
      };
    },
    () => now
  );
  const tiles = Array.from({ length: 150 }, (_, i) => ({
    z: 4,
    row: Math.floor(i / 15),
    col: i % 15,
  }));
  await Promise.all(tiles.map((t) => batcher.get('user', image, 'key', t)));
  await tick();
  assert(batches.length >= 2);
  assert(batches.every((b) => b.length <= MAX_TILE_BATCH));
  const previous = batches.length;
  now += 3590000;
  await batcher.get('user', image, 'key', tiles[0]);
  assert(batches.length > previous);
});
test('failed signing rejects demand tiles and retries cleanly', async () => {
  let attempts = 0;
  const batcher = new TileUrlBatcher(async (_context, _key, tiles) => {
    if (!attempts++) throw new Error('Unauthorized');
    return {
      expiresAt: Date.now() + 3600000,
      tiles: tiles.map((t) => ({ ...t, url: 'url' })),
    };
  });
  const tile = { z: 4, row: 0, col: 0 };
  await assert.rejects(batcher.get('user', image, 'key', tile), /Unauthorized/);
  await batcher.get('user', image, 'key', tile);
});
test('signout rejects in-flight requests and discards late results', async () => {
  let finish!: () => void;
  const batcher = new TileUrlBatcher(async (_context, _key, tiles) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return {
      expiresAt: Date.now() + 3600000,
      tiles: tiles.map((t) => ({ ...t, url: 'url' })),
    };
  });
  const pending = batcher.get('user', image, 'key', { z: 4, row: 0, col: 0 });
  const rejected = assert.rejects(pending, /session changed/);
  await tick();
  batcher.invalidate();
  finish();
  await rejected;
});
