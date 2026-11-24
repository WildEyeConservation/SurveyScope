import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { composeCrop, cutCrop } from './composeCrop.mjs';

const tile = (r, g, b, width = 256, height = 256) =>
  sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: 1 } },
  })
    .png()
    .toBuffer();

test('composes overhanging tiles into one square crop', async () => {
  const pieces = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      pieces.push({
        bytes: await tile(row * 100, col * 100, 50),
        left: col * 256 - 88,
        top: row * 256 - 44,
      });
  const out = await composeCrop(512, pieces);
  const { data, info } = await sharp(out)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [512, 512]);
  const near = (x, y, rgb) => {
    const at = (y * 512 + x) * info.channels;
    rgb.forEach((v, i) => assert.ok(Math.abs(data[at + i] - v) < 24));
  };
  near(10, 10, [0, 0, 50]);
  near(300, 10, [0, 100, 50]);
  near(450, 500, [200, 200, 50]);
});

test('refuses a crop the tiles do not fully cover', async () => {
  const pieces = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      pieces.push({
        bytes: await tile(9, 9, 9, col === 2 ? 50 : 256, 256),
        left: col * 256 - 88,
        top: row * 256 - 44,
      });
  assert.equal(await composeCrop(512, pieces), null);
});

test('cuts a crop from the decoded source only when it fits', async () => {
  const { data, info } = await sharp({
    create: { width: 700, height: 600, channels: 3, background: '#336699' },
  })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const source = { raw: data, info };
  const out = await cutCrop(source, { left: 100, top: 50, width: 512, height: 512 });
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 512, 512]);
  for (const crop of [
    { left: 200, top: 50, width: 512, height: 512 },
    { left: -1, top: 50, width: 512, height: 512 },
    { left: 100, top: 89, width: 512, height: 512 },
  ])
    assert.equal(await cutCrop(source, crop), null);
});
