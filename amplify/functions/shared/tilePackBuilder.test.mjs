import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import sharp from 'sharp';
import { buildTilePack } from './tilePackBuilder.mjs';
import { decodeHeader, pyramid, tileIndex } from '../../../shared/tilePack';

const jpeg = (width, height, options = {}) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .jpeg(options)
    .toBuffer();

async function readTile(pack, decoded, zoom, row, column) {
  const entry = decoded.entries[tileIndex(decoded.levels, zoom, row, column)];
  const bytes = pack.subarray(entry.offset, entry.offset + entry.length);
  return sharp(bytes).raw().toBuffer({ resolveWithObject: true });
}

test('builds the whole pyramid into one pack', async () => {
  const { pack, width, height, tileCount } = await buildTilePack(
    await jpeg(700, 300)
  );
  const decoded = decodeHeader(new Uint8Array(pack));
  assert.ok(decoded.complete);
  assert.deepEqual(decoded.meta, {
    width: 700,
    height: 300,
    tileSize: 256,
    maxZoom: 2,
    format: 'image/webp',
  });
  assert.equal(width, 700);
  assert.equal(height, 300);
  assert.equal(tileCount, pyramid(decoded.meta).tileCount);
  assert.equal(tileCount, 1 + 2 + 6);
  const last = decoded.entries[decoded.entries.length - 1];
  assert.equal(last.offset + last.length, pack.length);

  const interior = await readTile(pack, decoded, 2, 0, 0);
  assert.equal(interior.info.width, 256);
  assert.equal(interior.info.height, 256);
  assert.equal(interior.info.channels, 3);

  // Column 2 at full resolution covers x 512..767, so x >= 188 is outside.
  const edge = await readTile(pack, decoded, 2, 1, 2);
  assert.equal(edge.info.channels, 4);
  const alpha = (x, y) => edge.data[(y * 256 + x) * 4 + 3];
  assert.equal(alpha(0, 0), 255);
  assert.equal(alpha(187, 0), 255);
  assert.equal(alpha(188, 0), 0);
  // Row 1 covers y 256..511, so y >= 44 is outside.
  assert.equal(alpha(0, 43), 255);
  assert.equal(alpha(0, 44), 0);
  assert.ok(Math.abs(edge.data[0] - 200) < 8);
});

test('sizes the pack from the oriented image', async () => {
  const rotated = await sharp(await jpeg(700, 300))
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const { width, height } = await buildTilePack(rotated);
  assert.equal(width, 300);
  assert.equal(height, 700);
});
