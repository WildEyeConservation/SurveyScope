import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPaginatedResults } from '../utils';
import {
  assignTransectsToStrata,
  segmentBySavedTransect,
  splitBoundary,
  type LatLng,
  type SurveyImage,
} from './transectStrata';

const square: LatLng[] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];

const image = (
  id: string,
  latitude: number,
  longitude: number,
  dbTransectId: string | null
): SurveyImage => ({
  id,
  timestamp: 0,
  cameraId: null,
  latitude,
  longitude,
  dbTransectId,
});

test('a line across the boundary splits it in two', () => {
  const parts = splitBoundary(square, [
    [
      [0.5, -0.5],
      [0.5, 1.5],
    ],
  ]);
  assert.equal(parts.length, 2);
});

test('a line that misses the boundary leaves it whole', () => {
  const parts = splitBoundary(square, [
    [
      [2, -0.5],
      [2, 1.5],
    ],
  ]);
  assert.deepEqual(parts, [square]);
});

test('transects take the stratum of their first image, else the nearest', () => {
  const { segmented, dbIdByIndex } = segmentBySavedTransect([
    image('a', 0.25, 0.5, 'south'),
    image('b', 0.75, 0.5, 'south'),
    image('c', 0.75, 0.5, 'north'),
    image('d', 5, 0.5, 'far-north'),
    image('e', 0.5, 0.5, null),
  ]);
  assert.deepEqual(dbIdByIndex, ['south', 'north', 'far-north']);
  const strata = splitBoundary(square, [
    [
      [0.5, -0.5],
      [0.5, 1.5],
    ],
  ]);
  const northIndex = strata.findIndex((ring) =>
    ring.some(([lat]) => lat === 1)
  );
  const assignment = assignTransectsToStrata(segmented, strata);
  assert.equal(assignment.get(0), 1 - northIndex);
  assert.equal(assignment.get(1), northIndex);
  assert.equal(assignment.get(2), northIndex);
});

test('aborting stops paging', async () => {
  const controller = new AbortController();
  let calls = 0;
  const query = async () => {
    calls++;
    controller.abort();
    return { data: [calls], nextToken: 'more' };
  };
  await assert.rejects(
    fetchAllPaginatedResults(query, { limit: 1, signal: controller.signal })
  );
  assert.equal(calls, 1);
});

test('the signal is passed to the query as a trailing option', async () => {
  const controller = new AbortController();
  const seen: unknown[][] = [];
  const query = async (...args: unknown[]) => {
    seen.push(args);
    return { data: [1], nextToken: null };
  };
  await fetchAllPaginatedResults(query, {
    projectId: 'p',
    signal: controller.signal,
  });
  assert.deepEqual(seen[0][0], { projectId: 'p' });
  assert.deepEqual(seen[0][2], { signal: controller.signal });
});
