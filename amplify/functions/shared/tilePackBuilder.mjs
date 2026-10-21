import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { decodeForTiling } from './tilingDecode.mjs';
import { encodeHeader, maxZoomFor, pyramid } from '../../../shared/tilePack';

const TILE_SIZE = 256;
const WEBP_QUALITY = 90;
// libuv's default pool has 4 threads.
const ENCODE_CONCURRENCY = 4;

// A build never repeats an operation, so the cache would only hold memory.
sharp.cache(false);

// Preserve edge colours under transparent padding to prevent WebP darkening.
function encodeTile(raster, pictureWidth, pictureHeight, row, column) {
  const left = column * TILE_SIZE;
  const top = row * TILE_SIZE;
  const columns = Math.min(TILE_SIZE, pictureWidth - left);
  const rows = Math.min(TILE_SIZE, pictureHeight - top);
  const whole = columns === TILE_SIZE && rows === TILE_SIZE;
  const channels = whole ? 3 : 4;
  const stride = TILE_SIZE * channels;
  const tile = Buffer.alloc(TILE_SIZE * stride);
  for (let y = 0; y < TILE_SIZE; y++) {
    const from = ((top + Math.min(y, rows - 1)) * raster.width + left) * 3;
    if (whole) {
      raster.data.copy(tile, y * stride, from, from + stride);
      continue;
    }
    for (let x = 0; x < TILE_SIZE; x++) {
      const source = from + Math.min(x, columns - 1) * 3;
      const target = y * stride + x * 4;
      tile[target] = raster.data[source];
      tile[target + 1] = raster.data[source + 1];
      tile[target + 2] = raster.data[source + 2];
      tile[target + 3] = x < columns && y < rows ? 255 : 0;
    }
  }
  return sharp(tile, { raw: { width: TILE_SIZE, height: TILE_SIZE, channels } })
    .webp({ quality: WEBP_QUALITY, exact: !whole })
    .toBuffer();
}

async function encodeLevel(raster, pictureWidth, pictureHeight, level) {
  const tiles = new Array(level.rows * level.columns);
  let next = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const index = next++;
      tiles[index] = await encodeTile(
        raster,
        pictureWidth,
        pictureHeight,
        Math.floor(index / level.columns),
        index % level.columns
      );
    }
  };
  await Promise.all(Array.from({ length: ENCODE_CONCURRENCY }, worker));
  return tiles;
}

async function halve(raster) {
  const width = raster.width / 2;
  const height = raster.height / 2;
  const data = await sharp(raster.data, {
    raw: { width: raster.width, height: raster.height, channels: 3 },
  })
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();
  return { data, width, height };
}

export async function buildTilePack(buffer) {
  const metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  const swap = (metadata.orientation ?? 1) >= 5;
  const width = swap ? metadata.height : metadata.width;
  const height = swap ? metadata.width : metadata.height;
  const maxZoom = maxZoomFor(width, height, TILE_SIZE);
  const meta = {
    width,
    height,
    tileSize: TILE_SIZE,
    maxZoom,
    format: 'image/webp',
  };
  const { levels } = pyramid(meta);

  // Pad to a multiple of 2^maxZoom so halving levels never drifts.
  const unit = 2 ** maxZoom;
  const paddedWidth = Math.ceil(width / unit) * unit;
  const paddedHeight = Math.ceil(height / unit) * unit;
  const { data, info } = await decodeForTiling(buffer)
    .extend({
      right: paddedWidth - width,
      bottom: paddedHeight - height,
      extendWith: 'copy',
    })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    info.width !== paddedWidth ||
    info.height !== paddedHeight ||
    info.channels !== 3
  ) {
    throw new Error(
      `Decoded ${info.width}x${info.height}x${info.channels}, expected ${paddedWidth}x${paddedHeight}x3`
    );
  }

  let raster = { data, width: paddedWidth, height: paddedHeight };
  const tilesByLevel = new Array(levels.length);
  for (let zoom = maxZoom; zoom >= 0; zoom--) {
    const scale = 2 ** (maxZoom - zoom);
    tilesByLevel[zoom] = await encodeLevel(
      raster,
      Math.ceil(width / scale),
      Math.ceil(height / scale),
      levels[zoom]
    );
    if (zoom > 0) raster = await halve(raster);
  }
  const tiles = tilesByLevel.flat();
  const header = encodeHeader(
    meta,
    tiles.map((tile) => tile.length)
  );
  return {
    pack: Buffer.concat([header, ...tiles]),
    width,
    height,
    tileCount: tiles.length,
  };
}
