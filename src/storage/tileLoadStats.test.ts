import test from 'node:test';
import assert from 'node:assert/strict';
import { busyTime, createTileLoadStats } from './tileLoadStats';

const timing = (
  kind: 'header' | 'tile',
  totalMs: number,
  extra: Partial<{ queueMs: number; ttfbMs: number; bytes: number; status: number }> = {}
) => ({ kind, queueMs: 0, ttfbMs: totalMs / 2, totalMs, bytes: 100, status: 206, ...extra });

test('sums requests per task', () => {
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
  stats.sharedInFlight('a');
  stats.generate('a', 900, 4);
  stats.request('b', 'pack', timing('tile', 10));

  const a = stats.take('a')!;
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
  assert.equal(a.sharedInFlight, 1);
  assert.equal(a.generateCalls, 1);
  assert.equal(a.generatedTiles, 4);

  assert.equal(stats.take('a'), undefined);
  assert.equal(stats.take('b')!.packTileRequests, 1);
});

test('busy time counts overlapping image work once and skips idle gaps', () => {
  let clock = 0;
  const stats = createTileLoadStats(() => clock);
  clock = 10_000;
  stats.step('a', 'receive', 200);
  stats.step('a', 'hydrate', 500);
  clock = 20_000;
  stats.markPrefetched('a');
  stats.step('a', 'fileLookup', 300);
  clock = 20_400;
  stats.sign('a', 250);
  clock = 21_000;
  stats.request('a', 'pack', timing('tile', 500));
  stats.request('a', 'pack', timing('tile', 300));
  clock = 60_000;
  stats.cacheHit('a');
  stats.request('a', 'pack', timing('tile', 200));

  const a = stats.take('a')!;
  // 300 lookup + 250 sign (overlaps nothing) + 500 tiles + 200 later tile.
  assert.equal(a.imageBusyMs, 300 + 250 + 500 + 200);
  assert.equal(a.receiveMs, 200);
  assert.equal(a.hydrateMs, 500);
  assert.equal(a.fileLookupMs, 300);
  assert.equal(a.prefetched, 1);
  stats.cacheHit('b');
  assert.equal(stats.take('b')!.imageBusyMs, 0);
});

test('busyTime merges overlapping and touching intervals', () => {
  assert.equal(busyTime([]), 0);
  assert.equal(busyTime([[5, 10], [0, 3], [2, 6], [10, 12]]), 12);
  assert.equal(busyTime([[0, 10], [2, 4]]), 10);
});

test('forgets the oldest tasks beyond the cap', () => {
  const stats = createTileLoadStats(() => 0);
  for (let i = 0; i <= 100; i++) stats.cacheHit(`task${i}`);
  assert.equal(stats.take('task0'), undefined);
  assert.equal(stats.take('task100')!.cacheHits, 1);
});
