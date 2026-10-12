import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import exifr from 'exifr';
import {
  composedOrientation,
  normalizeCorrection,
  normalizeDamagedImageOrientation,
  normalizeImageOrientation,
} from './orientation.mjs';

test('normalizes supported correction values', () => {
  assert.equal(normalizeCorrection('90'), 90);
  assert.equal(normalizeCorrection(180), 180);
  assert.equal(normalizeCorrection(270), 270);
  assert.equal(normalizeCorrection(45), 0);
  assert.equal(normalizeCorrection(undefined), 0);
});

test('composes a CCW correction after existing EXIF orientation', () => {
  assert.equal(composedOrientation(1, 90), 8);
  assert.equal(composedOrientation(6, 90), 1);
  assert.equal(composedOrientation(8, 270), 1);
  assert.equal(composedOrientation(2, 180), 4);
});

async function jpegWithOrientation(orientation) {
  return sharp({
    create: {
      width: 4,
      height: 2,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

test('physically rotates pixels and resets EXIF orientation', async () => {
  const input = await jpegWithOrientation(1);
  const output = await normalizeImageOrientation(input, 90);
  const metadata = await sharp(output).metadata();
  const exif = await exifr.parse(output, {
    pick: ['ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight'],
  });

  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 4);
  assert.equal(metadata.orientation, 1);
  assert.equal(exif.ImageWidth, 2);
  assert.equal(exif.ImageHeight, 4);
  assert.equal(exif.ExifImageWidth, 2);
  assert.equal(exif.ExifImageHeight, 4);
});

test('preserves source EXIF while normalizing orientation', async () => {
  const input = await sharp({
    create: {
      width: 4,
      height: 2,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .withExif({
      IFD0: { Artist: 'Orientation test' },
      IFD3: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'E' },
    })
    .withMetadata({ orientation: 1 })
    .jpeg()
    .toBuffer();

  const output = await normalizeImageOrientation(input, 90);
  const exif = await exifr.parse(output, {
    pick: ['Artist', 'GPSLatitudeRef', 'GPSLongitudeRef', 'Orientation'],
  });

  assert.equal(exif.Artist, 'Orientation test');
  assert.equal(exif.GPSLatitudeRef, 'S');
  assert.equal(exif.GPSLongitudeRef, 'E');
  assert.equal(exif.Orientation, 'Horizontal (normal)');
});

test('accounts for existing EXIF orientation before correction', async () => {
  const input = await jpegWithOrientation(6);
  const output = await normalizeImageOrientation(input, 90);
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.orientation, 1);
});

async function truncatedJpeg() {
  const noise = Buffer.alloc(256 * 128 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  const jpeg = await sharp(noise, {
    raw: { width: 256, height: 128, channels: 3 },
  })
    .jpeg()
    .toBuffer();
  return jpeg.subarray(0, Math.floor(jpeg.length / 2));
}

test('rotates a truncated JPEG and flags it as damaged', async () => {
  const input = await truncatedJpeg();
  await assert.rejects(normalizeImageOrientation(input, 90));

  const { buffer, damaged, reason } = await normalizeDamagedImageOrientation(
    input,
    90
  );
  const metadata = await sharp(buffer).metadata();

  assert.equal(damaged, true);
  assert.match(reason, /premature end/i);
  assert.equal(metadata.width, 128);
  assert.equal(metadata.height, 256);
  await sharp(buffer).raw().toBuffer();
});

test('does not flag an intact JPEG as damaged', async () => {
  const input = await jpegWithOrientation(1);
  const { damaged } = await normalizeDamagedImageOrientation(input, 90);

  assert.equal(damaged, false);
});

test('still rejects input that cannot be decoded at all', async () => {
  await assert.rejects(
    normalizeDamagedImageOrientation(Buffer.from('not an image'), 90)
  );
});
