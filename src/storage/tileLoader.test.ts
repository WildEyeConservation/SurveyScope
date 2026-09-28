import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAuthorizedTile } from './tileLoader';
function fixture() {
  const events: string[] = [];
  return {
    events,
    ops: {
      sign: async () => {
        events.push('sign');
        return { url: 'signed', expiresAt: Date.now() + 3600000 };
      },
      evict: () => {
        events.push('evict');
      },
      readCache: async (): Promise<Blob | null> => {
        events.push('cache');
        return null;
      },
      writeCache: async () => {
        events.push('write');
      },
      fetch: async () => {
        events.push('fetch');
        return new Response('tile', { status: 200 });
      },
      generate: async () => {
        events.push('generate');
        return new Blob(['generated']);
      },
      assertCurrentSession: () => {},
    },
  };
}
test('authorization precedes persistent cache access; cached bytes need no download', async () => {
  const { events, ops } = fixture();
  ops.readCache = async () => {
    events.push('cache');
    return new Blob(['cached']);
  };
  assert.equal(await (await loadAuthorizedTile(ops)).text(), 'cached');
  assert.deepEqual(events, ['sign', 'cache']);
  ops.sign = async () => {
    throw new Error('Unauthorized');
  };
  await assert.rejects(loadAuthorizedTile(ops), /Unauthorized/);
  assert.deepEqual(events, ['sign', 'cache']);
});
test('only a missing object invokes generation', async () => {
  const { events, ops } = fixture();
  ops.fetch = async () => new Response(null, { status: 404 });
  assert.equal(await (await loadAuthorizedTile(ops)).text(), 'generated');
  assert(events.includes('generate'));
  for (const status of [403, 500]) {
    events.length = 0;
    ops.fetch = async () => new Response(null, { status });
    await assert.rejects(loadAuthorizedTile(ops), new RegExp(String(status)));
    assert(!events.includes('generate'));
    assert.equal(
      events.filter((e) => e === 'sign').length,
      status === 403 ? 2 : 1
    );
  }
});
test('refreshes an expired S3 signature once and prevents late delivery after signout', async () => {
  const { events, ops } = fixture();
  let attempts = 0;
  ops.fetch = async () =>
    new Response('tile', { status: attempts++ ? 200 : 403 });
  assert.equal(await (await loadAuthorizedTile(ops)).text(), 'tile');
  assert(events.includes('evict'));
  ops.writeCache = async () => {
    ops.assertCurrentSession = () => {
      throw new Error('Session changed');
    };
  };
  await assert.rejects(loadAuthorizedTile(ops), /Session changed/);
});
