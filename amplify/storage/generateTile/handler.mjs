import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import sharp from 'sharp';
import { env } from '$amplify/env/generateTile';
import { resolveImageAccess, db, table } from '../imageAccess/repository';
import {
  validTile,
  MAX_GENERATED_TILE_BATCH,
} from '../../../shared/imageTiles';

const s3 = new S3Client();

async function stampTiledAt(imageId) {
  try {
    await db.send(
      new UpdateCommand({
        TableName: table('Image'),
        Key: { id: imageId },
        UpdateExpression: 'SET tiledAt = :now',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':now': new Date().toISOString() },
      })
    );
  } catch (err) {
    console.log(
      JSON.stringify({ msg: 'stamp_tiled_at_failed', imageId, error: err.message })
    );
  }
}

// LRU source cache kept in module scope. Warm invocations that target a
// recently-seen image skip both the S3 fetch and the JPEG decode. Size 3
// fits comfortably under the 2GB Lambda memory limit (each raw buffer for
// a 60MP RGB image is ~180MB; observed peak with 1-entry was 620MB).
const SOURCE_CACHE_CAPACITY = 3;
const sourceCache = new Map(); // imageKey -> { raw, info: { width, height, channels } }

function sourceCacheGet(imageKey) {
  const entry = sourceCache.get(imageKey);
  if (!entry) return null;
  // Re-insert to mark as most-recently-used (Map preserves insertion order).
  sourceCache.delete(imageKey);
  sourceCache.set(imageKey, entry);
  return entry;
}

function sourceCacheSet(imageKey, entry) {
  if (sourceCache.has(imageKey)) {
    sourceCache.delete(imageKey);
  } else if (sourceCache.size >= SOURCE_CACHE_CAPACITY) {
    const oldestKey = sourceCache.keys().next().value;
    sourceCache.delete(oldestKey);
  }
  sourceCache.set(imageKey, entry);
}

function getMaxZoom(width, height) {
  return Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / 256)));
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchSourceBytes(imageKey) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.INPUTS_BUCKET_NAME,
      Key: imageKey,
    })
  );
  return streamToBuffer(response.Body);
}

async function getSource(imageKey, timings) {
  const cached = sourceCacheGet(imageKey);
  if (cached) {
    timings.cacheHit = true;
    timings.cacheSize = sourceCache.size;
    return cached;
  }
  timings.cacheHit = false;

  const fetchStart = performance.now();
  const imageBuffer = await fetchSourceBytes(imageKey);
  timings.fetchSourceMs = performance.now() - fetchStart;
  timings.sourceBytes = imageBuffer.length;

  const decodeStart = performance.now();
  const { data, info } = await sharp(imageBuffer)
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  timings.decodeMs = performance.now() - decodeStart;
  timings.rawBytes = data.length;

  const entry = { raw: data, info };
  sourceCacheSet(imageKey, entry);
  timings.cacheSize = sourceCache.size;
  return entry;
}

async function fetchTileFromS3(outputKey) {
  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: env.OUTPUTS_BUCKET_NAME,
        Key: outputKey,
      })
    );
    return await streamToBuffer(response.Body);
  } catch (err) {
    if (
      err?.name === 'NoSuchKey' ||
      err?.Code === 'NoSuchKey' ||
      err?.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}

async function generateSingleTile(source, z, row, col) {
  const { raw, info } = source;
  const { width, height, channels } = info;
  const maxZ = getMaxZoom(width, height);

  if (z > maxZ) return null;

  const tilePixels = 256 * Math.pow(2, maxZ - z);
  const x0 = col * tilePixels;
  const y0 = row * tilePixels;

  if (x0 >= width || y0 >= height) return null;

  const extractW = Math.min(tilePixels, width - x0);
  const extractH = Math.min(tilePixels, height - y0);
  const outW = Math.max(1, Math.round((256 * extractW) / tilePixels));
  const outH = Math.max(1, Math.round((256 * extractH) / tilePixels));

  let pipeline = sharp(raw, { raw: { width, height, channels } })
    .extract({ left: x0, top: y0, width: extractW, height: extractH })
    .resize(outW, outH);

  if (outW < 256 || outH < 256) {
    pipeline = pipeline.extend({
      right: 256 - outW,
      bottom: 256 - outH,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }

  return pipeline.png().toBuffer();
}

async function uploadTile(tileBuffer, outputKey) {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.OUTPUTS_BUCKET_NAME,
      Key: outputKey,
      Body: tileBuffer,
      ContentType: 'image/png',
    })
  );
}

/**
 * AppSync query handler.
 *
 * Arguments:
 *   imageKey - the source image key (e.g. 'images/orgId/projectId/image.jpg')
 *   zs       - array of zoom levels
 *   rows     - array of tile rows
 *   cols     - array of tile columns
 *
 * Returns an array of base64-encoded PNG tile data, one per input tile, in
 * the same order. Empty string for tiles outside the image bounds.
 *
 * Strategy (hybrid):
 *   1. Check S3 outputs bucket for each requested tile in parallel.
 *   2. For tiles that miss, decode the source image once (cached across
 *      invocations in module scope) and generate each missing tile from raw.
 *   3. Upload the newly-generated tiles back to S3 so subsequent requests —
 *      including from other Lambda containers / other users — can serve
 *      them cheaply.
 */
export async function handler(event) {
  const { imageId, sharedImageId, zs, rows, cols } = event.arguments;
  const requestedKey = event.arguments.imageKey?.replace(/^images\//, '');
  if (!imageId || !requestedKey) {
    throw new Error('Image id and source key are required');
  }
  if (!Array.isArray(zs) || !Array.isArray(rows) || !Array.isArray(cols)) {
    throw new Error('Missing required parameters: zs, rows, cols');
  }
  if (zs.length !== rows.length || zs.length !== cols.length) {
    throw new Error('zs, rows, cols must all be the same length');
  }
  if (zs.length > MAX_GENERATED_TILE_BATCH) {
    throw new Error(`At most ${MAX_GENERATED_TILE_BATCH} tiles per request`);
  }
  if (zs.length === 0) {
    return [];
  }

  const access = await resolveImageAccess(event.identity, {
    imageId,
    sourceKey: requestedKey,
    sharedImageId,
  });
  const imageKey = `images/${access.sourceKey}`;
  for (let i = 0; i < zs.length; i++) {
    if (!validTile({ z: zs[i], row: rows[i], col: cols[i] }, access.image)) {
      throw new Error(`Invalid tile coordinate at index ${i}`);
    }
  }

  const timings = {
    tileCount: zs.length,
    s3HitCount: 0,
    s3MissCount: 0,
    s3CheckMs: 0,
    cacheHit: false,
    fetchSourceMs: 0,
    sourceBytes: 0,
    decodeMs: 0,
    rawBytes: 0,
    tileWorkMs: 0,
    uploadTilesMs: 0,
  };
  const totalStart = performance.now();

  try {
    const sourceKey = imageKey.replace(/^images\//, '');
    const outputKeys = zs.map(
      (z, i) => `slippymaps/${sourceKey}/${z}/${rows[i]}/${cols[i]}.png`
    );

    // Step 1: probe S3 for every requested tile in parallel.
    const s3CheckStart = performance.now();
    const tileBuffers = await Promise.all(outputKeys.map(fetchTileFromS3));
    timings.s3CheckMs = performance.now() - s3CheckStart;

    const missingIndices = [];
    tileBuffers.forEach((buf, i) => {
      if (!buf) missingIndices.push(i);
    });
    timings.s3HitCount = zs.length - missingIndices.length;
    timings.s3MissCount = missingIndices.length;

    // Step 2: generate only the tiles that weren't already on S3.
    if (missingIndices.length > 0) {
      const source = await getSource(imageKey, timings);
      timings.imageWidth = source.info.width;
      timings.imageHeight = source.info.height;
      timings.maxZ = getMaxZoom(source.info.width, source.info.height);

      const tileWorkStart = performance.now();
      const generated = await Promise.all(
        missingIndices.map((i) =>
          generateSingleTile(source, zs[i], rows[i], cols[i])
        )
      );
      timings.tileWorkMs = performance.now() - tileWorkStart;

      // Step 3: upload the new tiles (in parallel) and slot them into the result.
      // Upload failures are logged but do not fail the request — the generated
      // tile data is still returned to the caller; only the S3 write-back is lost.
      const uploadStart = performance.now();
      let uploadFailures = 0;
      await Promise.all(
        generated.map((buf, j) => {
          const i = missingIndices[j];
          tileBuffers[i] = buf;
          if (!buf) return null;
          return uploadTile(buf, outputKeys[i]).catch((e) => {
            uploadFailures++;
            console.log(
              JSON.stringify({
                msg: 'tile_upload_failed',
                key: outputKeys[i],
                error: e.message,
              })
            );
          });
        })
      );
      timings.uploadTilesMs = performance.now() - uploadStart;
      timings.uploadFailures = uploadFailures;

      if (!access.shared) {
        await stampTiledAt(imageId);
      }
    }

    const result = tileBuffers.map((buf) => (buf ? buf.toString('base64') : ''));

    timings.tileBytes = tileBuffers.reduce(
      (sum, b) => sum + (b ? b.length : 0),
      0
    );
    timings.totalMs = performance.now() - totalStart;
    timings.msPerTile = timings.totalMs / zs.length;

    console.log(
      JSON.stringify({
        msg: 'tiles_generated',
        imageKey,
        tiles: zs.map((z, i) => `${z}/${rows[i]}/${cols[i]}`),
        ...timings,
      })
    );

    return result;
  } catch (err) {
    timings.totalMs = performance.now() - totalStart;
    console.log(
      JSON.stringify({
        msg: 'tiles_failed',
        imageKey,
        error: err.message,
        ...timings,
      })
    );
    throw err;
  }
}
