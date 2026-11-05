import { fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import localforage from 'localforage';
import {
  MAX_GENERATED_TILE_BATCH,
  type TileCoordinate,
} from '../shared/imageTiles';
import {
  GENERATE_TILE,
  SIGN_TILES,
  SIGN_TILE_PACK,
  storageOperation,
} from './storage/api';
import { loadAuthorizedTile } from './storage/tileLoader';
import {
  tileLoadStats,
  timed,
  type TileRequestTiming,
} from './storage/tileLoadStats';
import {
  TilePackRegistry,
  loadPackTile,
  openSignedTilePack,
} from './storage/tilePackSource';
import {
  TileUrlBatcher,
  tileImageKey,
  type SignedTileBatch,
  type TileContext,
} from './storage/tileUrlBatcher';

const forTask = (context: TileContext, record: (taskId: string) => void) => {
  if (context.taskId) record(context.taskId);
};

// One callback per task, so a merged read counts once for each task waiting on it.
const packReporters = new Map<string, (timing: TileRequestTiming) => void>();
function packReporter(taskId: string) {
  let reporter = packReporters.get(taskId);
  if (!reporter) {
    reporter = (timing) => tileLoadStats.request(taskId, 'pack', timing);
    packReporters.set(taskId, reporter);
    for (const oldest of packReporters.keys()) {
      if (packReporters.size <= 200) break;
      packReporters.delete(oldest);
    }
  }
  return reporter;
}

export type { TileContext } from './storage/tileUrlBatcher';

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
  timed(
    () =>
      storageOperation<SignedTileBatch>(
        SIGN_TILES,
        {
          imageId: context.imageId,
          sharedImageId: context.sharedImageId,
          sourceKey,
          tiles: JSON.stringify(tiles),
        },
        'signImageTiles',
      ),
    (ms) => forTask(context, (id) => tileLoadStats.sign(id, ms, true)),
  ),
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
    packs.clear();
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

export function imageTileContext(
  image: {
    id: string;
    width: number;
    height: number;
    sharedImageId?: string;
  },
  taskId?: string,
): TileContext {
  return {
    imageId: image.id,
    taskId,
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
  context: TileContext,
) {
  for (
    let offset = 0;
    offset < batch.length;
    offset += MAX_GENERATED_TILE_BATCH
  ) {
    const chunk = batch.slice(offset, offset + MAX_GENERATED_TILE_BATCH);
    try {
      const result = await timed(
        () =>
          storageOperation<string[]>(
            GENERATE_TILE,
            {
              imageKey: `images/${sourceKey}`,
              imageId: context.imageId,
              sharedImageId: context.sharedImageId,
              zs: chunk.map((t) => t.z),
              rows: chunk.map((t) => t.row),
              cols: chunk.map((t) => t.col),
            },
            'generateTile',
          ),
        (ms) =>
          forTask(context, (id) =>
            tileLoadStats.generate(id, ms, chunk.length),
          ),
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
  scope: string,
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

const packs = new TilePackRegistry();

const openPack = (scope: string, context: TileContext, sourceKey: string) =>
  packs.get(tileImageKey(scope, context, sourceKey), () =>
    openSignedTilePack(() => signTilePack(context, sourceKey), context, {
      onRequest: (timing) =>
        forTask(context, (id) => tileLoadStats.request(id, 'pack', timing)),
    }),
  );

export async function primeImageTiles(sourceKey: string, context: TileContext) {
  const epoch = sessionEpoch;
  const scope = await sessionScope();
  if (epoch === sessionEpoch) await openPack(scope, context, sourceKey);
}

function signTilePack(context: TileContext, sourceKey: string) {
  return timed(
    () =>
      storageOperation<{ url: string | null; expiresAt: number }>(
        SIGN_TILE_PACK,
        {
          imageId: context.imageId,
          sharedImageId: context.sharedImageId,
          sourceKey,
        },
        'signImageTilePack',
      ),
    (ms) => forTask(context, (id) => tileLoadStats.sign(id, ms)),
  ).then((signed) =>
    signed.url ? { url: signed.url, expiresAt: signed.expiresAt } : null,
  );
}

async function fetchLegacyTile(taskId: string | undefined, url: string) {
  const sentAt = performance.now();
  const response = await fetch(url, { cache: 'no-store' });
  const ttfbMs = performance.now() - sentAt;
  const body = response.ok ? await response.arrayBuffer() : null;
  if (taskId)
    tileLoadStats.request(taskId, 'legacy', {
      kind: 'tile',
      queueMs: 0,
      ttfbMs,
      totalMs: performance.now() - sentAt,
      bytes: body?.byteLength ?? 0,
      status: response.status,
    });
  if (!body) return response;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

const TILE_PATH = /^slippymaps\/(.+)\/(\d+)\/(\d+)\/(\d+)\.png$/;
const blobsInFlight = new Map<string, Promise<Blob>>();

export async function getTileBlob(
  path: string,
  context: TileContext,
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

  const imageKey = tileImageKey(scope, context, sourceKey);
  const key = `${imageKey}:${path}`;
  const existing = blobsInFlight.get(key);
  if (existing) {
    forTask(context, (id) => tileLoadStats.sharedInFlight(id));
    return existing;
  }

  const readCache = async () => {
    const cached = await tileCache.getItem<Blob>(key);
    if (cached) forTask(context, (id) => tileLoadStats.cacheHit(id));
    return cached;
  };
  const legacy = () =>
    loadAuthorizedTile({
      sign: () => urls.get(scope, context, sourceKey, tile),
      evict: () => urls.evict(scope, context, sourceKey, tile),
      readCache,
      writeCache: (blob) => tileCache.setItem(key, blob),
      fetch: (url) => fetchLegacyTile(context.taskId, url),
      generate: () => generateTile(sourceKey, context, tile, scope),
      assertCurrentSession,
    });
  const work = loadPackTile({
    tile,
    onRequest: context.taskId ? packReporter(context.taskId) : undefined,
    open: () => openPack(scope, context, sourceKey),
    forget: () => packs.forget(imageKey),
    legacy,
    readCache,
    writeCache: (blob) => tileCache.setItem(key, blob),
    assertCurrentSession,
  });
  blobsInFlight.set(key, work);
  try {
    return await work;
  } finally {
    blobsInFlight.delete(key);
  }
}
