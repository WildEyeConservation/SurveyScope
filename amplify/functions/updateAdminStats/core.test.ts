import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  addDays,
  changedFields,
  daysBetween,
  desiredRows,
  imagesToday,
  monthsBetween,
  tallyByDay,
  type Counts,
} from './core';

test('addDays crosses month and year ends', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2025-12-31', 1), '2026-01-01');
});

test('monthsBetween is inclusive', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), [
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
  ]);
  assert.deepEqual(monthsBetween('2026-02', '2026-02'), ['2026-02']);
});

test('imagesToday credits only the gain beyond earlier days', () => {
  const rows = new Map<string, Counts>([
    ['2026-10-01', { images: 100, annotations: 4 }],
    ['2026-10-02', { annotations: 2 }],
    ['2026-10-27', { images: 30 }],
  ]);
  assert.equal(imagesToday(150, rows, '2026-10-27'), 50);
  assert.equal(imagesToday(90, rows, '2026-10-27'), -10);
});

test('daysBetween is inclusive and crosses month ends', () => {
  assert.deepEqual(daysBetween('2026-10-30', '2026-11-01'), [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
  ]);
  assert.deepEqual(daysBetween('2026-11-01', '2026-11-01'), ['2026-11-01']);
});

test('tallyByDay groups by UTC day and skips missing dates', () => {
  const into = new Map<string, Counts>([['2026-10-26', { annotations: 1 }]]);
  tallyByDay(
    ['2026-10-26T23:59:59.000Z', '2026-10-27T00:00:00.000Z', undefined],
    'annotations',
    into,
  );
  assert.deepEqual(Object.fromEntries(into), {
    '2026-10-26': { annotations: 2 },
    '2026-10-27': { annotations: 1 },
  });
});

test('desiredRows zeroes covered rows the recount no longer has', () => {
  const stored = new Map<string, Counts>([
    ['2026-10-26', { annotations: 3, images: 7 }],
    ['2026-10-01', { annotations: 9 }],
  ]);
  const recount = new Map<string, Counts>([['2026-10-27', { annotations: 1 }]]);
  const desired = desiredRows(
    stored,
    recount,
    ['annotations'],
    (day) => day >= '2026-10-26',
  );
  assert.deepEqual(Object.fromEntries(desired), {
    '2026-10-26': { annotations: 0 },
    '2026-10-27': { annotations: 1 },
  });
});

test('changedFields treats missing values as zero', () => {
  assert.deepEqual(changedFields(undefined, { images: 0, annotations: 2 }), {
    annotations: 2,
  });
  assert.deepEqual(changedFields({ images: 5 }, { images: 5 }), {});
});
