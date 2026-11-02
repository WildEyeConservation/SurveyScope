export type TileRequestKind = 'header' | 'tile';

export interface TileRequestTiming {
  kind: TileRequestKind;
  queueMs: number;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  status: number;
}

export type TaskStep = 'receive' | 'hydrate' | 'fileLookup';

export interface TileLoadMetrics {
  /** First network request to last byte; idle time between them is included. */
  spanMs: number;
  receiveMs: number;
  hydrateMs: number;
  fileLookupMs: number;
  /** 1 when tiles were warmed ahead of the task being mounted. */
  prefetched: number;
  signCalls: number;
  signMs: number;
  signMaxMs: number;
  headerRequests: number;
  headerMs: number;
  headerBytes: number;
  packTileRequests: number;
  legacyTileRequests: number;
  tileQueueMs: number;
  tileTtfbMs: number;
  tileTtfbMaxMs: number;
  tileMs: number;
  tileMaxMs: number;
  tileBytes: number;
  failedRequests: number;
  missingTiles: number;
  cacheHits: number;
  generateCalls: number;
  generateMs: number;
  generatedTiles: number;
  connectionRttMs?: number;
  connectionDownlinkMbps?: number;
}

type Entry = Omit<
  TileLoadMetrics,
  'spanMs' | 'connectionRttMs' | 'connectionDownlinkMbps'
> & { firstAt: number; lastAt: number };

const MAX_IMAGES = 100;

const blank = (): Entry => ({
  firstAt: Infinity,
  lastAt: -Infinity,
  receiveMs: 0,
  hydrateMs: 0,
  fileLookupMs: 0,
  prefetched: 0,
  signCalls: 0,
  signMs: 0,
  signMaxMs: 0,
  headerRequests: 0,
  headerMs: 0,
  headerBytes: 0,
  packTileRequests: 0,
  legacyTileRequests: 0,
  tileQueueMs: 0,
  tileTtfbMs: 0,
  tileTtfbMaxMs: 0,
  tileMs: 0,
  tileMaxMs: 0,
  tileBytes: 0,
  failedRequests: 0,
  missingTiles: 0,
  cacheHits: 0,
  generateCalls: 0,
  generateMs: 0,
  generatedTiles: 0,
});

export function createTileLoadStats(now: () => number = () => Date.now()) {
  const images = new Map<string, Entry>();

  // Cache reads must not extend the network span.
  const entry = (imageId: string, startedAt?: number, touch = true) => {
    const at = now();
    let current = images.get(imageId);
    if (!current) {
      current = blank();
      images.set(imageId, current);
      for (const oldest of images.keys()) {
        if (images.size <= MAX_IMAGES) break;
        images.delete(oldest);
      }
    }
    if (touch) {
      current.firstAt = Math.min(current.firstAt, startedAt ?? at);
      current.lastAt = Math.max(current.lastAt, at);
    }
    return current;
  };

  return {
    sign(imageId: string, ms: number) {
      const e = entry(imageId, now() - ms);
      e.signCalls++;
      e.signMs += ms;
      e.signMaxMs = Math.max(e.signMaxMs, ms);
    },
    request(imageId: string, source: 'pack' | 'legacy', t: TileRequestTiming) {
      const e = entry(imageId, now() - t.queueMs - t.totalMs);
      if (t.status === 404) e.missingTiles++;
      else if (t.status !== 200 && t.status !== 206) e.failedRequests++;
      if (t.kind === 'header') {
        e.headerRequests++;
        e.headerMs += t.queueMs + t.totalMs;
        e.headerBytes += t.bytes;
        return;
      }
      if (source === 'pack') e.packTileRequests++;
      else e.legacyTileRequests++;
      e.tileQueueMs += t.queueMs;
      e.tileTtfbMs += t.ttfbMs;
      e.tileTtfbMaxMs = Math.max(e.tileTtfbMaxMs, t.ttfbMs);
      e.tileMs += t.totalMs;
      e.tileMaxMs = Math.max(e.tileMaxMs, t.totalMs);
      e.tileBytes += t.bytes;
    },
    cacheHit(imageId: string) {
      entry(imageId, undefined, false).cacheHits++;
    },
    step(imageId: string, step: TaskStep, ms: number, endedAgoMs = 0) {
      entry(imageId, now() - endedAgoMs - ms)[`${step}Ms`] += ms;
    },
    markPrefetched(imageId: string) {
      entry(imageId, undefined, false).prefetched = 1;
    },
    generate(imageId: string, ms: number, tiles: number) {
      const e = entry(imageId, now() - ms);
      e.generateCalls++;
      e.generateMs += ms;
      e.generatedTiles += tiles;
    },
    take(imageId: string): TileLoadMetrics | undefined {
      const e = images.get(imageId);
      if (!e) return undefined;
      images.delete(imageId);
      const { firstAt, lastAt, ...counts } = e;
      const round = (v: number) => Math.round(v);
      const metrics = Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, round(v)])
      ) as Omit<TileLoadMetrics, 'spanMs'>;
      const spanMs = lastAt > firstAt ? round(lastAt - firstAt) : 0;
      return { ...metrics, spanMs, ...connection() };
    },
  };
}

function connection(): Pick<
  TileLoadMetrics,
  'connectionRttMs' | 'connectionDownlinkMbps'
> {
  const info =
    typeof navigator === 'undefined'
      ? undefined
      : (
          navigator as Navigator & {
            connection?: { rtt?: number; downlink?: number };
          }
        ).connection;
  return {
    ...(typeof info?.rtt === 'number' ? { connectionRttMs: info.rtt } : {}),
    ...(typeof info?.downlink === 'number'
      ? { connectionDownlinkMbps: info.downlink }
      : {}),
  };
}

export const tileLoadStats = createTileLoadStats();

export async function timed<T>(
  task: () => Promise<T>,
  record: (ms: number) => void
): Promise<T> {
  const start = performance.now();
  try {
    return await task();
  } finally {
    record(performance.now() - start);
  }
}
