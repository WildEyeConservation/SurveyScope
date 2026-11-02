import test from 'node:test';
import assert from 'node:assert/strict';
import { createTileLoadStats } from './tileLoadStats';

const timing = (
  kind: 'header' | 'tile',
  totalMs: number,
  extra: Partial<{ queueMs: number; ttfbMs: number; bytes: number; status: number }> = {}
) => ({ kind, queueMs: 0, ttfbMs: totalMs / 2, totalMs, bytes: 100, status: 206, ...extra });

test('sums requests per image and spans from first request to last byte', () => {
  let clock = 1_000;
  const stats = createTileLoadStats(() => clock);
  stats.sign('a', 200);
  clock = 1_300;
  stats.request('a', 'pack', timing('header', 100));
  clock = 1_700;
  stats.request('a', 'pack', timing('tile', 300, { queueMs: 50, ttfbMs: 250, bytes: 1000 }));
  stats.request('a', 'pack', timing('tile', 100, { bytes: 500 }));
  stats.request('a', 'legacy', timing('tile', 80, { status: 404, bytes: 0 }));
  stats.request('a', 'legacy', timing('tile', 80, { status: 500, bytes: 0 }));
  stats.cacheHit('a');
  stats.generate('a', 900, 4);
  stats.request('b', 'pack', timing('tile', 10));

  const a = stats.take('a')!;
  assert.equal(a.spanMs, 1_700 - 800);
  assert.equal(a.signCalls, 1);
  assert.equal(a.signMs, 200);
  assert.equal(a.headerRequests, 1);
  assert.equal(a.headerMs, 100);
  assert.equal(a.packTileRequests, 2);
  assert.equal(a.legacyTileRequests, 2);
  assert.equal(a.tileQueueMs, 50);
  assert.equal(a.tileTtfbMaxMs, 250);
  assert.equal(a.tileMaxMs, 300);
  assert.equal(a.tileBytes, 1500);
  assert.equal(a.missingTiles, 1);
  assert.equal(a.failedRequests, 1);
  assert.equal(a.cacheHits, 1);
  assert.equal(a.generateCalls, 1);
  assert.equal(a.generatedTiles, 4);

  assert.equal(stats.take('a'), undefined);
  assert.equal(stats.take('b')!.packTileRequests, 1);
});

test('forgets the oldest images beyond the cap', () => {
  const stats = createTileLoadStats(() => 0);
  for (let i = 0; i <= 100; i++) stats.cacheHit(`img${i}`);
  assert.equal(stats.take('img0'), undefined);
  assert.equal(stats.take('img100')!.cacheHits, 1);
});

test('cache reads and prefetch marks do not stretch the span', () => {
  let clock = 0;
  const stats = createTileLoadStats(() => clock);
  stats.cacheHit('a');
  clock = 5_000;
  stats.markPrefetched('a');
  stats.step('a', 'fileLookup', 300);
  clock = 6_000;
  stats.request('a', 'pack', timing('tile', 200));
  clock = 60_000;
  stats.cacheHit('a');
  const a = stats.take('a')!;
  assert.equal(a.spanMs, 6_000 - 4_700);
  assert.equal(a.fileLookupMs, 300);
  assert.equal(a.prefetched, 1);
  assert.equal(a.cacheHits, 2);
  stats.cacheHit('b');
  assert.equal(stats.take('b')!.spanMs, 0);
});
