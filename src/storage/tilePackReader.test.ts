import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHeader,
  HEADER_GUESS_BYTES,
  pyramid,
  type TilePackMeta,
} from '../../shared/tilePack';
import {
  isAbort,
  makeLimiter,
  openTilePack,
  TileCutShort,
  TileOutsideImage,
  TilePackRequestFailed,
  type TilePackAccess,
} from './tilePackReader';

// Tile `i` is `lengthOf(i)` bytes, each of value `i % 251`.
function buildPack(
  meta: TilePackMeta,
  lengthOf: (index: number) => number = () => 4
) {
  const { tileCount } = pyramid(meta);
  const lengths = Array.from({ length: tileCount }, (_, i) => lengthOf(i));
  const header = encodeHeader(meta, lengths);
  const file = new Uint8Array(
    header.length + lengths.reduce((a, b) => a + b, 0)
  );
  file.set(header, 0);
  let offset = header.length;
  lengths.forEach((length, i) => {
    file.fill(i % 251, offset, offset + length);
    offset += length;
  });
  return { file, headerLength: header.length, tileCount };
}

const SMALL: TilePackMeta = {
  width: 600,
  height: 400,
  tileSize: 256,
  maxZoom: 2,
  format: 'image/webp',
};

// In-memory storage answering range requests; URLs in `expired` get 403.
function storage(file: Uint8Array, expired: string[] = []) {
  const calls: { url: string; first: number; last: number }[] = [];
  const state = {
    etag: '"v1"' as string | null,
    file,
    ignoreRange: false,
    cutShort: 0,
    caches: [] as (RequestCache | undefined)[],
  };
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const range = /^bytes=(\d+)-(\d+)$/.exec(
      new Headers(init?.headers).get('Range') ?? ''
    );
    if (!range) throw new Error('Expected a range request');
    const first = Number(range[1]);
    const last = Number(range[2]);
    calls.push({ url, first, last });
    if (expired.includes(url)) return new Response('expired', { status: 403 });
    const headers: Record<string, string> =
      state.etag === null ? {} : { etag: state.etag };
    if (first >= state.file.length) return new Response('', { status: 416 });
    if (state.ignoreRange)
      return new Response(state.file.slice(), { status: 200, headers });
    state.caches.push(init?.cache);
    if (state.cutShort > 0) {
      state.cutShort--;
      return new Response(state.file.slice(first, first + 1), {
        status: 206,
        headers,
      });
    }
    return new Response(state.file.slice(first, last + 1), {
      status: 206,
      headers,
    });
  };
  return { fetchFn, calls, state };
}

const access = (
  url: string,
  expiresAt = Number.MAX_SAFE_INTEGER
): TilePackAccess => ({ url, expiresAt });
const never = async (): Promise<TilePackAccess> => {
  throw new Error('No refresh expected');
};
const bytesOf = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)];

test('reads the header once and serves tiles by range', async () => {
  const { file, headerLength } = buildPack(SMALL, (i) => i + 1);
  const store = storage(file);
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  const header = await pack.header();
  assert.deepEqual(header.meta, SMALL);
  assert.equal(header.entries.length, 9);
  assert.deepEqual(store.calls, [
    { url: 'u', first: 0, last: HEADER_GUESS_BYTES - 1 },
  ]);
  // Level 2 starts at index 3 and is three columns wide.
  assert.deepEqual(bytesOf(await pack.tile(2, 1, 2)), Array(9).fill(8));
  assert.deepEqual(bytesOf(await pack.tile(0, 0, 0)), [0]);
  await pack.header();
  assert.equal(store.calls.length, 3);
  assert.deepEqual(store.calls[1], {
    url: 'u',
    first: file.length - 9,
    last: file.length - 1,
  });
  assert.deepEqual(store.calls[2], {
    url: 'u',
    first: headerLength,
    last: headerLength,
  });
});

test('refuses a tile outside the image', async () => {
  const store = storage(buildPack(SMALL).file);
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  await assert.rejects(pack.tile(2, 2, 0), TileOutsideImage);
  await assert.rejects(pack.tile(3, 0, 0), TileOutsideImage);
  await assert.rejects(pack.tile(1, 0, -1), TileOutsideImage);
  assert.equal(store.calls.length, 1);
});

test('fetches the rest of a header larger than the first range', async () => {
  const big = { ...SMALL, width: 32768, height: 32768, maxZoom: 7 };
  const { file, headerLength, tileCount } = buildPack(big, () => 1);
  assert.ok(headerLength > HEADER_GUESS_BYTES);
  const store = storage(file);
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  assert.equal((await pack.header()).entries.length, tileCount);
  assert.deepEqual(store.calls, [
    { url: 'u', first: 0, last: HEADER_GUESS_BYTES - 1 },
    { url: 'u', first: HEADER_GUESS_BYTES, last: headerLength - 1 },
  ]);
  assert.deepEqual(bytesOf(await pack.tile(7, 127, 127)), [
    (tileCount - 1) % 251,
  ]);
});

test('reports a truncated header and does not remember the failure', async () => {
  const { file, headerLength } = buildPack(SMALL);
  const store = storage(file.slice(0, headerLength - 3));
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  await assert.rejects(pack.header(), /cut short/);
  store.state.file = file;
  assert.equal((await pack.header()).entries.length, 9);
});

test('copes with storage that ignores Range', async () => {
  const store = storage(buildPack(SMALL, (i) => i + 1).file);
  store.state.ignoreRange = true;
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  assert.deepEqual(bytesOf(await pack.tile(1, 0, 1)), [2, 2, 2]);
});

test('renews once on 403 and retries; concurrent reads share the renewal', async () => {
  const store = storage(buildPack(SMALL).file, ['old']);
  let refreshes = 0;
  const pack = openTilePack({
    access: access('old'),
    refresh: async () => {
      refreshes++;
      return access('new');
    },
    fetch: store.fetchFn,
  });
  const [tile] = await Promise.all([
    pack.tile(1, 0, 0),
    pack.tile(1, 0, 1),
    pack.header(),
  ]);
  assert.deepEqual(bytesOf(tile), [1, 1, 1, 1]);
  assert.equal(refreshes, 1);
  assert.deepEqual(
    store.calls.map((c) => c.url),
    ['old', 'new', 'new', 'new']
  );
});

test('gives up when the renewed URL is refused too', async () => {
  const store = storage(buildPack(SMALL).file, ['old', 'new']);
  let refreshes = 0;
  const pack = openTilePack({
    access: access('old'),
    refresh: async () => {
      refreshes++;
      return access('new');
    },
    fetch: store.fetchFn,
  });
  const failure = await pack.header().catch((error: unknown) => error);
  assert.ok(failure instanceof TilePackRequestFailed);
  assert.equal(failure.status, 403);
  assert.equal(refreshes, 1);
});

test('renews a URL about to expire before using it', async () => {
  const store = storage(buildPack(SMALL).file);
  const pack = openTilePack({
    access: access('old', 1_010_000),
    refresh: async () => access('new'),
    fetch: store.fetchFn,
    now: () => 1_000_000,
  });
  await pack.header();
  assert.deepEqual(
    store.calls.map((c) => c.url),
    ['new']
  );
});

test('authorize renews only when the URL is about to expire', async () => {
  let time = 1_000_000;
  let refreshes = 0;
  const pack = openTilePack({
    access: access('old', 1_100_000),
    refresh: async () => {
      refreshes++;
      return access('new', time + 3_600_000);
    },
    fetch: storage(buildPack(SMALL).file).fetchFn,
    now: () => time,
  });
  await pack.authorize();
  assert.equal(refreshes, 0);
  time = 1_080_000;
  await pack.authorize();
  await pack.authorize();
  assert.equal(refreshes, 1);
});

test('re-reads the header when the pack was rebuilt', async () => {
  const store = storage(buildPack(SMALL, () => 4).file);
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  await pack.header();
  store.state.file = buildPack(SMALL, (i) => i + 1).file;
  store.state.etag = '"v2"';
  assert.deepEqual(bytesOf(await pack.tile(1, 0, 1)), [2, 2, 2]);
  assert.equal(store.calls.length, 4);
});

test('re-reads the header when a rebuilt pack is too small for old offsets', async () => {
  const large = buildPack(SMALL, () => 400);
  const small = buildPack(SMALL, (i) => i + 1);
  const store = storage(large.file);
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  await pack.header();
  store.state.file = small.file;
  store.state.etag = '"v2"';
  assert.deepEqual(bytesOf(await pack.tile(2, 1, 2)), Array(9).fill(8));
  assert.equal(store.calls.length, 4);
  assert.deepEqual(store.calls[3], {
    url: 'u',
    first: small.file.length - 9,
    last: small.file.length - 1,
  });
  assert.deepEqual(bytesOf(await pack.tile(1, 0, 1)), [2, 2, 2]);
  assert.equal(store.calls.length, 5);
});

test('retries a short read past the cache, then gives up', async () => {
  const store = storage(buildPack(SMALL, () => 4).file);
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  await pack.header();
  store.state.cutShort = 2;
  assert.deepEqual(bytesOf(await pack.tile(1, 0, 1)), [2, 2, 2, 2]);
  assert.equal(store.calls.length, 4);
  assert.deepEqual(store.state.caches, [
    'no-store',
    'no-store',
    'reload',
    'reload',
  ]);
  store.state.cutShort = 3;
  await assert.rejects(pack.tile(1, 0, 0), TileCutShort);
  assert.equal(store.calls.length, 7);
  assert.deepEqual(bytesOf(await pack.tile(1, 0, 0)), [1, 1, 1, 1]);
});

test('gives up when fresh offsets are refused too', async () => {
  const { file, headerLength } = buildPack(SMALL, () => 400);
  const store = storage(file.slice(0, headerLength));
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: store.fetchFn,
  });
  const failure = await pack.tile(2, 1, 2).catch((error: unknown) => error);
  assert.ok(failure instanceof TilePackRequestFailed);
  assert.equal(failure.status, 416);
  assert.equal(store.calls.length, 4);
});

test('passes on other failures', async () => {
  const pack = openTilePack({
    access: access('u'),
    refresh: never,
    fetch: async () => new Response('no', { status: 500 }),
  });
  await assert.rejects(pack.header(), TilePackRequestFailed);
});

test('limiter caps concurrency and skips tasks aborted while queued', async () => {
  const limiter = makeLimiter(2);
  const finish: (() => void)[] = [];
  const started: number[] = [];
  const task = (id: number) => () =>
    new Promise<number>((resolve) => {
      started.push(id);
      finish.push(() => resolve(id));
    });
  const cancelled = new AbortController();
  const results = [
    limiter.run(task(1)),
    limiter.run(task(2)),
    limiter.run(task(3), cancelled.signal),
    limiter.run(task(4)),
  ];
  await Promise.resolve();
  assert.deepEqual(started, [1, 2]);
  cancelled.abort();
  await assert.rejects(results[2], (error) => isAbort(error));
  finish[0]();
  await results[0];
  await Promise.resolve();
  assert.deepEqual(started, [1, 2, 4]);
  finish[1]();
  finish[2]();
  assert.deepEqual(await Promise.all([results[1], results[3]]), [2, 4]);
  assert.equal(limiter.active(), 0);
});
