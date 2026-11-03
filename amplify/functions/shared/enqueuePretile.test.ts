import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionTileStates } from './enqueuePretile';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-03T12:00:00Z');
const row = (id: string, tiledAt: string | null, originalPath: string | null = 'a.jpg') => ({
  id,
  tiledAt,
  originalPath,
});
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test('sorts images by tiling state', () => {
  const result = partitionTileStates(
    [
      row('fresh', new Date(now - 5 * DAY).toISOString()),
      row('ageing', new Date(now - 40 * DAY).toISOString()),
      row('missing', null),
      row('noSource', null, null),
    ],
    now
  );
  assert.deepEqual(ids(result.skippedFresh), ['fresh']);
  assert.deepEqual(ids(result.needsTiling), ['ageing', 'missing']);
  assert.deepEqual(ids(result.skippedNoSource), ['noSource']);
  assert.deepEqual(ids(result.needsRefresh), []);
});

test('re-tiles recent images that only have per-tile PNGs', () => {
  const result = partitionTileStates(
    [
      row('legacy', '2026-10-13T10:00:00Z'),
      row('packed', '2026-10-21T09:30:00Z'),
    ],
    now
  );
  assert.deepEqual(ids(result.needsTiling), ['legacy']);
  assert.deepEqual(ids(result.skippedFresh), ['packed']);
});

test('refreshes packed images between 30 and 55 days old', () => {
  const later = Date.parse('2026-12-01T12:00:00Z');
  const result = partitionTileStates(
    [row('packed', '2026-10-28T08:00:00Z'), row('old', '2026-10-01T08:00:00Z')],
    later
  );
  assert.deepEqual(ids(result.needsRefresh), ['packed']);
  assert.deepEqual(ids(result.needsTiling), ['old']);
});
