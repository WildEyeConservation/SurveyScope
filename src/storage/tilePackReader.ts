import {
  decodeHeader,
  HEADER_GUESS_BYTES,
  tileIndex,
  type TilePackEntry,
  type TilePackLevel,
  type TilePackMeta,
} from '../../shared/tilePack';
import type { TileRequestKind, TileRequestTiming } from './tileLoadStats';

// expiresAt uses epoch milliseconds.
export interface TilePackAccess {
  url: string;
  expiresAt: number;
}
export interface TilePackHeader {
  meta: TilePackMeta;
  levels: TilePackLevel[];
  entries: TilePackEntry[];
}

export class TileOutsideImage extends Error {
  constructor(zoom: number, row: number, column: number) {
    super(`Tile ${zoom}/${row}/${column} is outside the image`);
    this.name = 'TileOutsideImage';
  }
}
export class TilePackRequestFailed extends Error {
  constructor(readonly status: number) {
    super(`Tile pack request failed with status ${status}`);
    this.name = 'TilePackRequestFailed';
  }
}
export class TileCutShort extends Error {
  constructor(received: number, expected: number) {
    super(`Tile arrived cut short: ${received} of ${expected} bytes`);
    this.name = 'TileCutShort';
  }
}

const aborted = () => new DOMException('The request was aborted', 'AbortError');
export const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

export interface Limiter {
  run: <A>(task: () => Promise<A>, signal?: AbortSignal) => Promise<A>;
  active: () => number;
}

export function makeLimiter(limit: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(aborted());
      if (active < limit) {
        active++;
        return resolve();
      }
      const start = () => {
        signal?.removeEventListener('abort', cancel);
        active++;
        resolve();
      };
      const cancel = () => {
        waiting.splice(waiting.indexOf(start), 1);
        reject(aborted());
      };
      waiting.push(start);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  return {
    active: () => active,
    run: async (task, signal) => {
      await acquire(signal);
      try {
        return await task();
      } finally {
        active--;
        waiting.shift()?.();
      }
    },
  };
}

// Queue excess requests here so they remain cancellable before dispatch.
const sharedLimiter = makeLimiter(6);
const EXPIRY_MARGIN_MS = 30_000;
const SHORT_READ_RETRIES = 2;
const MAX_RUN_TILES = 32;
const MAX_RUN_BYTES = 2 * 1024 * 1024;

export interface TilePackOptions {
  access: TilePackAccess;
  refresh: () => Promise<TilePackAccess>;
  fetch?: typeof fetch;
  limiter?: Limiter;
  now?: () => number;
  onRequest?: (timing: TileRequestTiming) => void;
  /** First header read; sized from the image so one request usually suffices. */
  headerGuessBytes?: number;
}
export interface TilePack {
  authorize: () => Promise<void>;
  header: () => Promise<TilePackHeader>;
  tile: (
    zoom: number,
    row: number,
    column: number,
    signal?: AbortSignal,
    onRequest?: (timing: TileRequestTiming) => void
  ) => Promise<ArrayBuffer>;
}

type Header = TilePackHeader & { etag: string | null };

export function openTilePack(options: TilePackOptions): TilePack {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const limiter = options.limiter ?? sharedLimiter;
  const now = options.now ?? Date.now;
  let access = options.access;
  let renewing: Promise<void> | undefined;
  let header: Promise<Header> | undefined;

  const renew = (used: TilePackAccess) => {
    if (access !== used) return Promise.resolve();
    renewing ??= options
      .refresh()
      .then((fresh) => {
        access = fresh;
      })
      .finally(() => {
        renewing = undefined;
      });
    return renewing;
  };

  const range = async (
    kind: TileRequestKind,
    first: number,
    last: number,
    signal?: AbortSignal,
    reload = false,
    report = options.onRequest
  ): Promise<{ bytes: Uint8Array; etag: string | null }> => {
    for (let attempt = 0; ; attempt++) {
      if (access.expiresAt - now() < EXPIRY_MARGIN_MS) await renew(access);
      if (signal?.aborted) throw aborted();
      let used = access;
      const queuedAt = performance.now();
      const result = await limiter.run(async () => {
        if (renewing) await renewing.catch(() => undefined);
        used = access;
        const sentAt = performance.now();
        const response = await fetchFn(used.url, {
          headers: { Range: `bytes=${first}-${last}` },
          cache: reload ? 'reload' : 'no-store',
          signal,
        });
        const ttfbMs = performance.now() - sentAt;
        const timed = (bytes: number) =>
          report?.({
            kind,
            queueMs: sentAt - queuedAt,
            ttfbMs,
            totalMs: performance.now() - sentAt,
            bytes,
            status: response.status,
          });
        if (response.status !== 200 && response.status !== 206) {
          void response.body?.cancel().catch(() => undefined);
          timed(0);
          return response.status;
        }
        const body = new Uint8Array(await response.arrayBuffer());
        timed(body.length);
        return {
          // Storage that ignores Range sends the whole file.
          bytes: response.status === 200 ? body.slice(first, last + 1) : body,
          etag: response.headers.get('etag'),
        };
      }, signal);
      if (typeof result !== 'number') return result;
      if (result !== 403 || attempt > 0)
        throw new TilePackRequestFailed(result);
      await renew(used);
    }
  };

  const loadHeader = async (): Promise<Header> => {
    let asked = options.headerGuessBytes ?? HEADER_GUESS_BYTES;
    let { bytes, etag } = await range('header', 0, asked - 1);
    for (;;) {
      const decoded = decodeHeader(bytes);
      if (decoded.complete) return { ...decoded, etag };
      if (bytes.length < asked || decoded.needed <= bytes.length)
        throw new Error('Tile pack is cut short');
      const more = await range('header', bytes.length, decoded.needed - 1);
      const joined = new Uint8Array(bytes.length + more.bytes.length);
      joined.set(bytes, 0);
      joined.set(more.bytes, bytes.length);
      asked = decoded.needed;
      bytes = joined;
      etag = more.etag ?? etag;
    }
  };

  const readHeader = () => {
    if (!header) {
      const loading = loadHeader();
      header = loading;
      loading.catch(() => {
        if (header === loading) header = undefined;
      });
    }
    return header;
  };

  const contiguous = (entries: TilePackEntry[]) =>
    entries.every(
      (entry, i) =>
        i === 0 ||
        entries[i - 1].offset + entries[i - 1].length === entry.offset
    );

  const download = async (
    indices: number[],
    signal?: AbortSignal,
    report?: (timing: TileRequestTiming) => void
  ): Promise<ArrayBuffer[]> => {
    let short = 0;
    for (let attempt = 0; ; attempt++) {
      const current = readHeader();
      const head = await current;
      const entries = indices.map((index) => head.entries[index]);
      if (entries.some((entry) => !entry || entry.length === 0))
        throw new Error('Tile is empty');
      if (!contiguous(entries)) {
        const parts = await Promise.all(
          indices.map((index) => download([index], signal, report))
        );
        return parts.flat();
      }
      const first = entries[0].offset;
      const expected = entries.reduce((sum, entry) => sum + entry.length, 0);
      // 416 on the first try means a rebuilt pack that came out smaller.
      const read = await range(
        'tile',
        first,
        first + expected - 1,
        signal,
        short > 0,
        report
      ).catch((error: unknown) => {
        if (
          error instanceof TilePackRequestFailed &&
          error.status === 416 &&
          attempt === 0
        )
          return undefined;
        throw error;
      });
      if (read) {
        const rebuilt =
          read.etag !== null && head.etag !== null && read.etag !== head.etag;
        if (!rebuilt && read.bytes.length !== expected) {
          if (short >= SHORT_READ_RETRIES)
            throw new TileCutShort(read.bytes.length, expected);
          short++;
          attempt--;
          continue;
        }
        if (!rebuilt) {
          const { bytes } = read;
          return entries.map((entry) => {
            const start = bytes.byteOffset + entry.offset - first;
            return bytes.buffer.slice(
              start,
              start + entry.length
            ) as ArrayBuffer;
          });
        }
        if (attempt > 0) throw new Error('Tile pack keeps changing');
      }
      if (header === current) header = undefined;
    }
  };

  type Waiter = {
    index: number;
    resolve: (bytes: ArrayBuffer) => void;
    reject: (error: unknown) => void;
    aborted: boolean;
    onAbort?: () => void;
    onRequest?: (timing: TileRequestTiming) => void;
  };
  let waiting: Waiter[] = [];

  const flush = (head: Header) => {
    const batch = waiting.filter((waiter) => !waiter.aborted);
    waiting = [];
    const indices = [...new Set(batch.map((waiter) => waiter.index))].sort(
      (a, b) => a - b
    );
    const runs: number[][] = [];
    for (const index of indices) {
      const run = runs[runs.length - 1];
      const last = run?.[run.length - 1];
      const previous = last === undefined ? undefined : head.entries[last];
      const runBytes =
        run?.reduce((sum, i) => sum + head.entries[i].length, 0) ?? 0;
      if (
        run &&
        previous &&
        index === last! + 1 &&
        previous.offset + previous.length === head.entries[index].offset &&
        run.length < MAX_RUN_TILES &&
        runBytes + head.entries[index].length <= MAX_RUN_BYTES
      )
        run.push(index);
      else runs.push([index]);
    }
    for (const run of runs) {
      const members = batch.filter((waiter) => run.includes(waiter.index));
      // The shared request is cancelled only once nobody wants its bytes.
      const controller = new AbortController();
      for (const waiter of members) {
        waiter.onAbort = () => {
          if (members.every((member) => member.aborted)) controller.abort();
        };
      }
      const live = () => members.filter((waiter) => !waiter.aborted);
      const reporters = new Set(members.map((waiter) => waiter.onRequest));
      const report = (timing: TileRequestTiming) =>
        reporters.forEach((onRequest) => onRequest?.(timing));
      download(run, controller.signal, report).then(
        (buffers) =>
          live().forEach((waiter) => {
            const bytes = buffers[run.indexOf(waiter.index)];
            waiter.resolve(members.length > run.length ? bytes.slice(0) : bytes);
          }),
        (error: unknown) => live().forEach((waiter) => waiter.reject(error))
      );
    }
  };

  return {
    authorize: async () => {
      if (access.expiresAt - now() < EXPIRY_MARGIN_MS) await renew(access);
    },
    header: async () => {
      const { meta, levels, entries } = await readHeader();
      return { meta, levels, entries };
    },
    tile: async (zoom, row, column, signal, onRequest) => {
      const head = await readHeader();
      const index = tileIndex(head.levels, zoom, row, column);
      if (index === undefined) throw new TileOutsideImage(zoom, row, column);
      if (signal?.aborted) throw aborted();
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const waiter: Waiter = {
          index,
          resolve,
          reject,
          aborted: false,
          onRequest,
        };
        signal?.addEventListener(
          'abort',
          () => {
            waiter.aborted = true;
            reject(aborted());
            waiter.onAbort?.();
          },
          { once: true }
        );
        if (waiting.length === 0) setTimeout(() => flush(head), 0);
        waiting.push(waiter);
      });
    },
  };
}
