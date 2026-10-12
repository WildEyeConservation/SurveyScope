import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { decodeForTiling } from './tilingDecode.mjs';

async function truncatedJpeg() {
  const noise = Buffer.alloc(256 * 256 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  const jpeg = await sharp(noise, {
    raw: { width: 256, height: 256, channels: 3 },
  })
    .jpeg()
    .toBuffer();
  return jpeg.subarray(0, Math.floor(jpeg.length / 2));
}

test('strict decoding rejects a truncated JPEG', async () => {
  await assert.rejects(
    sharp(await truncatedJpeg())
      .raw()
      .toBuffer()
  );
});

test('tiling decode keeps full dimensions for a truncated JPEG', async () => {
  const { info } = await decodeForTiling(await truncatedJpeg())
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 256);
  assert.equal(info.height, 256);
});

test('tiling decode still rejects non-image input', async () => {
  await assert.rejects(
    decodeForTiling(Buffer.from('not an image')).raw().toBuffer()
  );
});
