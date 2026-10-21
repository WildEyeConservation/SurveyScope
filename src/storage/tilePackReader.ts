import {
  decodeHeader,
  HEADER_GUESS_BYTES,
  tileIndex,
  type TilePackEntry,
  type TilePackLevel,
  type TilePackMeta,
} from '../../shared/tilePack';

/** A signed pack URL and its expiry in epoch milliseconds. */
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

export interface TilePackOptions {
  access: TilePackAccess;
  refresh: () => Promise<TilePackAccess>;
  fetch?: typeof fetch;
  limiter?: Limiter;
  now?: () => number;
}
export interface TilePack {
  authorize: () => Promise<void>;
  header: () => Promise<TilePackHeader>;
  tile: (
    zoom: number,
    row: number,
    column: number,
    signal?: AbortSignal
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
    first: number,
    last: number,
    signal?: AbortSignal,
    reload = false
  ): Promise<{ bytes: Uint8Array; etag: string | null }> => {
    for (let attempt = 0; ; attempt++) {
      if (access.expiresAt - now() < EXPIRY_MARGIN_MS) await renew(access);
      if (signal?.aborted) throw aborted();
      let used = access;
      const result = await limiter.run(async () => {
        if (renewing) await renewing.catch(() => undefined);
        used = access;
        const response = await fetchFn(used.url, {
          headers: { Range: `bytes=${first}-${last}` },
          cache: reload ? 'reload' : 'no-store',
          signal,
        });
        if (response.status !== 200 && response.status !== 206) {
          void response.body?.cancel().catch(() => undefined);
          return response.status;
        }
        const body = new Uint8Array(await response.arrayBuffer());
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
    let asked = HEADER_GUESS_BYTES;
    let { bytes, etag } = await range(0, asked - 1);
    for (;;) {
      const decoded = decodeHeader(bytes);
      if (decoded.complete) return { ...decoded, etag };
      if (bytes.length < asked || decoded.needed <= bytes.length)
        throw new Error('Tile pack is cut short');
      const more = await range(bytes.length, decoded.needed - 1);
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

  const download = async (
    index: number,
    signal?: AbortSignal
  ): Promise<ArrayBuffer> => {
    let short = 0;
    for (let attempt = 0; ; attempt++) {
      const current = readHeader();
      const head = await current;
      const entry = head.entries[index];
      if (!entry || entry.length === 0) throw new Error('Tile is empty');
      // 416 on the first try means a rebuilt pack that came out smaller.
      const read = await range(
        entry.offset,
        entry.offset + entry.length - 1,
        signal,
        short > 0
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
        if (!rebuilt && read.bytes.length !== entry.length) {
          if (short >= SHORT_READ_RETRIES)
            throw new TileCutShort(read.bytes.length, entry.length);
          short++;
          attempt--;
          continue;
        }
        if (!rebuilt) {
          const { bytes } = read;
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
        }
        if (attempt > 0) throw new Error('Tile pack keeps changing');
      }
      if (header === current) header = undefined;
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
    tile: async (zoom, row, column, signal) => {
      const head = await readHeader();
      const index = tileIndex(head.levels, zoom, row, column);
      if (index === undefined) throw new TileOutsideImage(zoom, row, column);
      if (signal?.aborted) throw aborted();
      return download(index, signal);
    },
  };
}
