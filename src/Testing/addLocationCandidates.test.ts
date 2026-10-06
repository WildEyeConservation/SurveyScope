import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterCandidates,
  findAddedKeys,
  type PoolEntry,
} from './addLocationCandidates';

const entry = (
  locationId: string,
  x: number,
  categoryIds: string[],
  overrides: Partial<PoolEntry> = {}
): PoolEntry => ({
  annotationSetId: 'set',
  locationId,
  location: { imageId: 'img', x, y: 500, width: 1000, height: 1000 },
  categoryIds,
  ...overrides,
});

const pool = [
  entry('a', 500, ['zebra']),
  entry('b', 1500, ['zebra', 'impala', 'impala']),
  entry('c', 2500, ['impala']),
];

test('a copy in the pool marks the location it was made from as added', () => {
  const added = findAddedKeys(pool, [
    {
      annotationSetId: 'set',
      locationId: 'copy-of-b',
      location: { imageId: 'img', x: 1500, y: 500, width: 1000, height: 1000 },
    },
  ]);
  assert.ok(added.has('set_b'));
  assert.ok(!added.has('set_a'));
  assert.ok(!added.has('set_c'));
});

test('a resized and offset copy still matches its original', () => {
  const added = findAddedKeys(pool, [
    {
      annotationSetId: 'set',
      locationId: 'copy-of-b',
      location: { imageId: 'img', x: 1700, y: 400, width: 256, height: 256 },
    },
  ]);
  assert.deepEqual([...added].sort(), ['set_b', 'set_copy-of-b']);
});

test('a copy offset into a neighbour is matched by its recorded source', () => {
  const added = findAddedKeys(pool, [
    {
      annotationSetId: 'set',
      locationId: 'copy-of-a',
      sourceLocationId: 'a',
      location: { imageId: 'img', x: 1100, y: 500 },
    },
  ]);
  assert.deepEqual([...added].sort(), ['set_a', 'set_copy-of-a']);
});

test('a copy on a shared edge matches the nearest location only', () => {
  const overlapping = [entry('a', 500, ['zebra']), entry('b', 1300, ['zebra'])];
  const added = findAddedKeys(overlapping, [
    {
      annotationSetId: 'set',
      locationId: 'copy',
      location: { imageId: 'img', x: 950, y: 500 },
    },
  ]);
  assert.ok(added.has('set_b'));
  assert.ok(!added.has('set_a'));
});

test('copies on another image or annotation set do not match', () => {
  const added = findAddedKeys(pool, [
    {
      annotationSetId: 'set',
      locationId: 'other-image',
      location: { imageId: 'img2', x: 500, y: 500 },
    },
    {
      annotationSetId: 'set2',
      locationId: 'other-set',
      location: { imageId: 'img', x: 500, y: 500 },
    },
  ]);
  assert.ok(!added.has('set_a'));
});

test('a location added directly to the pool is marked as added', () => {
  const added = findAddedKeys(pool, [
    { annotationSetId: 'set', locationId: 'a', location: null },
  ]);
  assert.ok(added.has('set_a'));
});

test('filters by label and max annotations and skips excluded locations', () => {
  const ids = (categoryId: string, max: number | '', excluded: string[] = []) =>
    filterCandidates(pool, categoryId, max, new Set(excluded)).map(
      (c) => c.locationId
    );

  assert.deepEqual(ids('', ''), ['a', 'b', 'c']);
  assert.deepEqual(ids('impala', ''), ['b', 'c']);
  assert.deepEqual(ids('impala', 1), ['c']);
  assert.deepEqual(ids('', 1), ['a', 'c']);
  assert.deepEqual(ids('', '', ['set_a']), ['b', 'c']);
});

test('a location seen under two annotation sets is listed once', () => {
  const candidates = filterCandidates(
    [...pool, entry('a', 500, ['zebra'], { annotationSetId: 'set2' })],
    '',
    '',
    new Set()
  );
  assert.deepEqual(
    candidates.map((c) => `${c.annotationSetId}_${c.locationId}`),
    ['set_a', 'set_b', 'set_c']
  );
});
