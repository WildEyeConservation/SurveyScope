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
  /** Time with image requests in flight (lookup, signing, header, tiles); idle gaps excluded. */
  imageBusyMs: number;
  /** Busy time of the tile requests alone, without the file lookup, pack sign and header. */
  tileBusyMs: number;
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
  /** Tiles another task was already fetching. */
  sharedInFlight: number;
  generateCalls: number;
  generateMs: number;
  generatedTiles: number;
  connectionRttMs?: number;
  connectionDownlinkMbps?: number;
}

type Entry = Omit<
  TileLoadMetrics,
  'imageBusyMs' | 'tileBusyMs' | 'connectionRttMs' | 'connectionDownlinkMbps'
> & { busy: [number, number][]; tileBusy: [number, number][] };

const MAX_TASKS = 100;

const blank = (): Entry => ({
  busy: [],
  tileBusy: [],
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
  sharedInFlight: 0,
  generateCalls: 0,
  generateMs: 0,
  generatedTiles: 0,
});

export function busyTime(intervals: [number, number][]) {
  let total = 0;
  let reach = -Infinity;
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (to <= reach) continue;
    total += to - Math.max(from, reach);
    reach = to;
  }
  return total;
}

export function createTileLoadStats(now: () => number = () => Date.now()) {
  const tasks = new Map<string, Entry>();

  const entry = (taskId: string, busyMs?: number, tileStage = false) => {
    let current = tasks.get(taskId);
    if (!current) {
      current = blank();
      tasks.set(taskId, current);
      for (const oldest of tasks.keys()) {
        if (tasks.size <= MAX_TASKS) break;
        tasks.delete(oldest);
      }
    }
    if (busyMs !== undefined) {
      const at = now();
      current.busy.push([at - busyMs, at]);
      if (tileStage) current.tileBusy.push([at - busyMs, at]);
    }
    return current;
  };

  return {
    sign(taskId: string, ms: number, tileStage = false) {
      const e = entry(taskId, ms, tileStage);
      e.signCalls++;
      e.signMs += ms;
      e.signMaxMs = Math.max(e.signMaxMs, ms);
    },
    request(taskId: string, source: 'pack' | 'legacy', t: TileRequestTiming) {
      const e = entry(taskId, t.queueMs + t.totalMs, t.kind === 'tile');
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
    cacheHit(taskId: string) {
      entry(taskId).cacheHits++;
    },
    sharedInFlight(taskId: string) {
      entry(taskId).sharedInFlight++;
    },
    step(taskId: string, step: TaskStep, ms: number) {
      // Queue steps happen before the image is needed, so they are not busy time.
      entry(taskId, step === 'fileLookup' ? ms : undefined)[`${step}Ms`] += ms;
    },
    markPrefetched(taskId: string) {
      entry(taskId).prefetched = 1;
    },
    generate(taskId: string, ms: number, tiles: number) {
      const e = entry(taskId, ms, true);
      e.generateCalls++;
      e.generateMs += ms;
      e.generatedTiles += tiles;
    },
    take(taskId: string): TileLoadMetrics | undefined {
      const e = tasks.get(taskId);
      if (!e) return undefined;
      tasks.delete(taskId);
      const { busy, tileBusy, ...counts } = e;
      const metrics = Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, Math.round(v)]),
      ) as Omit<TileLoadMetrics, 'imageBusyMs' | 'tileBusyMs'>;
      return {
        ...metrics,
        imageBusyMs: Math.round(busyTime(busy)),
        tileBusyMs: Math.round(busyTime(tileBusy)),
        ...connection(),
      };
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
  // Browsers report 0 when they have no estimate.
  return {
    ...(info?.rtt ? { connectionRttMs: info.rtt } : {}),
    ...(info?.downlink ? { connectionDownlinkMbps: info.downlink } : {}),
  };
}

export const tileLoadStats = createTileLoadStats();

export async function timed<T>(
  task: () => Promise<T>,
  record: (ms: number) => void,
): Promise<T> {
  const start = performance.now();
  try {
    return await task();
  } finally {
    record(performance.now() - start);
  }
}
