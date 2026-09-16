import { getUrl } from 'aws-amplify/storage';
import localforage from 'localforage';
import { limitedClient } from './limitedClient';

/* Tile fetching for slippy maps stored on S3, accessed via individually
signed URLs (so a plain URL-template tile layer cannot be used). Missing
tiles are generated on demand by a Lambda, with concurrent requests batched
per source image, and everything is cached locally in IndexedDB.

Consumed by the MapLibre viewers through the `detweb://` protocol registered
in annotator/imageTiles.ts. */

// Configure a dedicated storage instance for tile URLs
const tileCache = localforage.createInstance({
  name: 'tileCache',
  storeName: 'tiles',
});

/**
 * Tile generation is batched client-side: concurrent Lambda calls for the same
 * source image are coalesced into a single AppSync call so the Lambda amortizes
 * one source fetch+decode across many tiles. We use setTimeout(0) rather than a
 * debounce window — any requests made in the current event-loop tick are swept
 * into the same batch, with no artificial latency.
 */

type PendingTile = {
  z: number;
  row: number;
  col: number;
  resolve: (blob: Blob) => void;
  reject: (err: Error) => void;
};

const pendingByImage = new Map<string, PendingTile[]>();
const timersByImage = new Map<string, ReturnType<typeof setTimeout>>();
const imageIdByKey = new Map<string, string>();

function base64ToBlob(b64: string): Blob {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'image/png' });
}

async function flushBatch(imageKey: string, batch: PendingTile[]) {
  try {
    const { data, errors } = await (limitedClient as any).queries.generateTile({
      imageKey,
      imageId: imageIdByKey.get(imageKey),
      zs: batch.map((t) => t.z),
      rows: batch.map((t) => t.row),
      cols: batch.map((t) => t.col),
    });

    if (errors?.length) throw new Error(errors[0].message);
    if (!data || !Array.isArray(data)) throw new Error('No tile data returned');

    data.forEach((b64: string | null, i: number) => {
      if (!b64) {
        batch[i].reject(new Error('Tile generation returned empty result'));
        return;
      }
      batch[i].resolve(base64ToBlob(b64));
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    batch.forEach((t) => t.reject(error));
  }
}

function generateTileOnDemand(
  imageKey: string,
  z: number,
  row: number,
  col: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let queue = pendingByImage.get(imageKey);
    if (!queue) {
      queue = [];
      pendingByImage.set(imageKey, queue);
    }
    queue.push({ z, row, col, resolve, reject });

    if (!timersByImage.has(imageKey)) {
      const timer = setTimeout(() => {
        timersByImage.delete(imageKey);
        const batch = pendingByImage.get(imageKey);
        pendingByImage.delete(imageKey);
        if (batch && batch.length > 0) {
          void flushBatch(imageKey, batch);
        }
      }, 0);
      timersByImage.set(imageKey, timer);
    }
  });
}

/**
 * Parse a slippy map tile path to extract the image key, zoom, row, and col.
 * Path format: slippymaps/{sourceKey}/{z}/{row}/{col}.png
 * Returns the full images/ key needed by the Lambda.
 */
function parseTilePath(path: string): {
  imageKey: string;
  z: number;
  row: number;
  col: number;
} | null {
  const match = path.match(
    /^slippymaps\/(.+)\/(\d+)\/(\d+)\/(\d+)\.png$/
  );
  if (!match) return null;
  return {
    imageKey: `images/${match[1]}`,
    z: parseInt(match[2], 10),
    row: parseInt(match[3], 10),
    col: parseInt(match[4], 10),
  };
}

const inFlightTiles = new Map<string, Promise<Blob>>();

export function getTileBlob(path: string): Promise<Blob> {
  const existing = inFlightTiles.get(path);
  if (existing) return existing;
  const request = loadTileBlob(path).finally(() => inFlightTiles.delete(path));
  inFlightTiles.set(path, request);
  return request;
}

async function loadTileBlob(path: string): Promise<Blob> {
  // Try to get from persistent cache first
  const cached: Blob | null = await tileCache.getItem(path);

  if (cached) {
    return cached;
  }

  const attemptFetch = async (getUrlArgs: any): Promise<Blob> => {
    const signedUrl = await getUrl(getUrlArgs);
    const response = await fetch(signedUrl.url.toString(), {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch tile: ${response.status} ${response.statusText}`
      );
    }
    const blob = await response.blob();
    await tileCache.setItem(path, blob);
    return blob;
  };

  // Try S3 direct first — for already-tiled images this is the fast path
  // (one network hop, progressive reveal). On 404, fall through to the
  // batched Lambda call, which handles generation + write-back.
  try {
    return await attemptFetch({ path });
  } catch (_) {
    const parsed = parseTilePath(path);
    if (!parsed) throw new Error(`Cannot parse tile path: ${path}`);

    const blob = await generateTileOnDemand(
      parsed.imageKey,
      parsed.z,
      parsed.row,
      parsed.col
    );
    await tileCache.setItem(path, blob);
    return blob;
  }
}

/** Associate an image id with its source key so on-demand tile generation
 * can pass the id to the Lambda (avoids a lookup server-side). */
export function registerImageIdForSource(sourceKey: string, imageId: string) {
  imageIdByKey.set(`images/${sourceKey}`, imageId);
}
