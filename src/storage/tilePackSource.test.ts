import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeHeader, pyramid } from '../../shared/tilePack';
import { TilePackRequestFailed, type TilePack } from './tilePackReader';
import {
  loadPackTile,
  openSignedTilePack,
  TilePackGone,
  TilePackRegistry,
  type OpenPack,
} from './tilePackSource';

const tile = { z: 0, row: 0, col: 0 };

function fakePack(overrides: Partial<TilePack> = {}): OpenPack {
  return {
    format: 'image/webp',
    pack: {
      authorize: async () => {},
      header: async () => {
        throw new Error('unused');
      },
      tile: async () => new Uint8Array([1, 2, 3]).buffer,
      ...overrides,
    },
  };
}

function fixture(open: OpenPack | null) {
  const events: string[] = [];
  return {
    events,
    ops: {
      tile,
      open: async () => {
        events.push('open');
        return open;
      },
      forget: () => {
        events.push('forget');
      },
      legacy: async () => {
        events.push('legacy');
        return new Blob(['legacy']);
      },
      readCache: async (): Promise<Blob | null> => {
        events.push('cache');
        return null;
      },
      writeCache: async () => {
        events.push('write');
      },
      assertCurrentSession: () => {},
    },
  };
}

test('images without a pack use the legacy path', async () => {
  const { events, ops } = fixture(null);
  assert.equal(await (await loadPackTile(ops)).text(), 'legacy');
  assert.deepEqual(events, ['open', 'legacy']);
});

test('pack tiles are authorized before the cache and cached with their type', async () => {
  const order: string[] = [];
  const { events, ops } = fixture(
    fakePack({
      authorize: async () => {
        order.push('authorize');
      },
    })
  );
  ops.readCache = async () => {
    order.push('cache');
    return null;
  };
  const blob = await loadPackTile(ops);
  assert.equal(blob.type, 'image/webp');
  assert.equal(blob.size, 3);
  assert.deepEqual(order, ['authorize', 'cache']);
  assert.deepEqual(events, ['open', 'write']);
});

test('revoked access is not hidden by cached bytes', async () => {
  const { ops } = fixture(
    fakePack({
      authorize: async () => {
        throw new Error('Unauthorized');
      },
    })
  );
  ops.readCache = async () => new Blob(['cached']);
  await assert.rejects(loadPackTile(ops), /Unauthorized/);
});

test('a pack that has gone falls back to legacy and is forgotten', async () => {
  for (const error of [
    new TilePackRequestFailed(404),
    new TilePackRequestFailed(403),
    new TilePackGone('gone'),
  ]) {
    const { events, ops } = fixture(
      fakePack({
        tile: async () => {
          throw error;
        },
      })
    );
    assert.equal(await (await loadPackTile(ops)).text(), 'legacy');
    assert.deepEqual(events, ['open', 'cache', 'forget', 'legacy']);
  }
});

test('transient pack failures propagate instead of falling back', async () => {
  const { events, ops } = fixture(
    fakePack({
      tile: async () => {
        throw new TilePackRequestFailed(503);
      },
    })
  );
  await assert.rejects(loadPackTile(ops), TilePackRequestFailed);
  assert.deepEqual(events, ['open', 'cache']);
});

test('registry remembers a missing pack for a while', async () => {
  let time = 0;
  const registry = new TilePackRegistry(32, 60_000, () => time);
  let opens = 0;
  const open = async () => {
    opens++;
    return null;
  };
  assert.equal(await registry.get('a', open), null);
  await Promise.resolve();
  assert.equal(await registry.get('a', open), null);
  assert.equal(opens, 1);
  time = 60_001;
  await registry.get('a', open);
  assert.equal(opens, 2);
});

test('registry retries transient failures without marking the pack missing', async () => {
  const registry = new TilePackRegistry();
  let opens = 0;
  await assert.rejects(
    registry.get('a', async () => {
      opens++;
      throw new TilePackRequestFailed(503);
    })
  );
  const open = fakePack();
  assert.equal(
    await registry.get('a', async () => {
      opens++;
      return open;
    }),
    open
  );
  assert.equal(opens, 2);
});

test('registry treats a pack that has gone as missing and evicts the oldest', async () => {
  const registry = new TilePackRegistry(2);
  assert.equal(
    await registry.get('gone', async () => {
      throw new TilePackRequestFailed(404);
    }),
    null
  );
  let opens = 0;
  const open = async () => {
    opens++;
    return fakePack();
  };
  await registry.get('a', open);
  await registry.get('b', open);
  await registry.get('c', open);
  await registry.get('a', open);
  assert.equal(opens, 4);
});

test('a pack cut from other dimensions is not used', async () => {
  const meta = {
    width: 600,
    height: 300,
    tileSize: 256,
    maxZoom: 2,
    format: 'image/webp',
  };
  const lengths = Array(pyramid(meta).tileCount).fill(1);
  const header = encodeHeader(meta, lengths);
  const file = new Uint8Array(header.length + lengths.length);
  file.set(header);
  const fetch = (async () =>
    new Response(file, { status: 200 })) as unknown as typeof globalThis.fetch;
  const sign = async () => ({ url: 'u', expiresAt: Date.now() + 3_600_000 });
  assert.equal(
    await openSignedTilePack(sign, { width: 601, height: 300 }, { fetch }),
    null
  );
  const open = await openSignedTilePack(
    sign,
    { width: 600, height: 300 },
    { fetch }
  );
  assert.equal(open?.format, 'image/webp');
  assert.equal(await openSignedTilePack(async () => null, meta), null);
});
