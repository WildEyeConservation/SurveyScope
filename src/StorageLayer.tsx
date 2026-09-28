import { fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import localforage from 'localforage';
import {
  MAX_GENERATED_TILE_BATCH,
  type TileCoordinate,
} from '../shared/imageTiles';
import { storageOperation, GENERATE_TILE, SIGN_TILES } from './storage/api';
import { loadAuthorizedTile } from './storage/tileLoader';
import {
  TileUrlBatcher,
  tileImageKey,
  type TileContext,
  type SignedTileBatch,
} from './storage/tileUrlBatcher';

export type { TileContext } from './storage/tileUrlBatcher';

// Slippy-map tiles: URLs are signed per image by the imageAccess backend,
// missing tiles are generated on demand, and bytes are cached in IndexedDB
// keyed by the signed-in identity. Used via the `detweb://` protocol.

const TILE_CACHE_NAME = 'tileCache';
const TILE_CACHE_STORE = 'authorizedTilesV1';
const TILE_CACHE_SCOPE_KEY = 'tileCache.scope';

const tileCache = localforage.createInstance({
  name: TILE_CACHE_NAME,
  storeName: TILE_CACHE_STORE,
});

// Drop the pre-authorization store, which is never read again.
void localforage
  .dropInstance({ name: TILE_CACHE_NAME, storeName: 'tiles' })
  .catch(() => {});

const urls = new TileUrlBatcher((context, sourceKey, tiles) =>
  storageOperation<SignedTileBatch>(
    SIGN_TILES,
    {
      imageId: context.imageId,
      sharedImageId: context.sharedImageId,
      sourceKey,
      tiles: JSON.stringify(tiles),
    },
    'signImageTiles'
  )
);

// Only a change of user rejects in-flight tiles; token refreshes must not.
let sessionEpoch = 0;
let scopePromise: Promise<string> | null = null;
const sessionListeners = new Set<() => void>();

/** Runs `listener` whenever the signed-in user changes. */
export function onImageSessionChange(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

Hub.listen('auth', ({ payload }) => {
  if (payload.event === 'signedIn' || payload.event === 'signedOut') {
    sessionEpoch++;
    scopePromise = null;
    urls.invalidate();
    sessionListeners.forEach((listener) => listener());
  } else if (payload.event === 'tokenRefresh') {
    scopePromise = null;
  }
});

async function resolveScope(): Promise<string> {
  const session = await fetchAuthSession();
  const sub = session.tokens?.idToken?.payload.sub;
  if (typeof sub !== 'string') throw new Error('Sign in to view images');
  const groups = session.tokens?.idToken?.payload['cognito:groups'];
  const scope = JSON.stringify([
    sub,
    Array.isArray(groups) ? [...groups].sort() : [],
  ]);
  // Bytes cached for another identity or group set are never reusable.
  if (localStorage.getItem(TILE_CACHE_SCOPE_KEY) !== scope) {
    await tileCache.clear();
    localStorage.setItem(TILE_CACHE_SCOPE_KEY, scope);
  }
  return scope;
}

function sessionScope(): Promise<string> {
  if (!scopePromise) {
    const promise = resolveScope();
    scopePromise = promise;
    promise.catch(() => {
      if (scopePromise === promise) scopePromise = null;
    });
  }
  return scopePromise;
}

export function imageTileContext(image: {
  id: string;
  width: number;
  height: number;
  sharedImageId?: string;
}): TileContext {
  return {
    imageId: image.id,
    width: image.width,
    height: image.height,
    sharedImageId: image.sharedImageId,
  };
}

type PendingTile = TileCoordinate & {
  resolve: (blob: Blob) => void;
  reject: (error: unknown) => void;
};

function base64ToBlob(b64: string): Blob {
  return new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
    type: 'image/png',
  });
}

// Generation requests made in the same tick are coalesced per image so the
// Lambda decodes the source once.
const generationQueues = new Map<string, PendingTile[]>();

async function flushGeneration(
  batch: PendingTile[],
  sourceKey: string,
  context: TileContext
) {
  for (
    let offset = 0;
    offset < batch.length;
    offset += MAX_GENERATED_TILE_BATCH
  ) {
    const chunk = batch.slice(offset, offset + MAX_GENERATED_TILE_BATCH);
    try {
      const result = await storageOperation<string[]>(
        GENERATE_TILE,
        {
          imageKey: `images/${sourceKey}`,
          imageId: context.imageId,
          sharedImageId: context.sharedImageId,
          zs: chunk.map((t) => t.z),
          rows: chunk.map((t) => t.row),
          cols: chunk.map((t) => t.col),
        },
        'generateTile'
      );
      chunk.forEach((entry, i) => {
        if (result[i]) entry.resolve(base64ToBlob(result[i]));
        else entry.reject(new Error('Tile generation returned no data'));
      });
    } catch (error) {
      chunk.forEach((entry) => entry.reject(error));
    }
  }
}

function generateTile(
  sourceKey: string,
  context: TileContext,
  tile: TileCoordinate,
  scope: string
): Promise<Blob> {
  const key = tileImageKey(scope, context, sourceKey);
  return new Promise((resolve, reject) => {
    let queue = generationQueues.get(key);
    if (!queue) {
      queue = [];
      generationQueues.set(key, queue);
      setTimeout(() => {
        const batch = generationQueues.get(key) ?? [];
        generationQueues.delete(key);
        void flushGeneration(batch, sourceKey, context);
      }, 0);
    }
    queue.push({ ...tile, resolve, reject });
  });
}

const TILE_PATH = /^slippymaps\/(.+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
const blobsInFlight = new Map<string, Promise<Blob>>();

export async function getTileBlob(
  path: string,
  context: TileContext
): Promise<Blob> {
  const match = TILE_PATH.exec(path);
  if (!match || !context.imageId) {
    throw new Error('Image identity and tile path are required');
  }
  const sourceKey = match[1];
  const tile = {
    z: Number(match[2]),
    row: Number(match[3]),
    col: Number(match[4]),
  };
  const epoch = sessionEpoch;
  const assertCurrentSession = () => {
    if (epoch !== sessionEpoch) throw new Error('Image session changed');
  };
  const scope = await sessionScope();
  assertCurrentSession();

  const key = `${tileImageKey(scope, context, sourceKey)}:${path}`;
  const existing = blobsInFlight.get(key);
  if (existing) return existing;

  const work = loadAuthorizedTile({
    sign: () => urls.get(scope, context, sourceKey, tile),
    evict: () => urls.evict(scope, context, sourceKey, tile),
    readCache: () => tileCache.getItem<Blob>(key),
    writeCache: (blob) => tileCache.setItem(key, blob),
    fetch: (url) => fetch(url, { cache: 'no-store' }),
    generate: () => generateTile(sourceKey, context, tile, scope),
    assertCurrentSession,
  });
  blobsInFlight.set(key, work);
  try {
    return await work;
  } finally {
    blobsInFlight.delete(key);
  }
}
