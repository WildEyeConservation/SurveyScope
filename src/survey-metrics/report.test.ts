import assert from 'node:assert/strict';
import test from 'node:test';
import { TILES, includedTiles } from './report';

const tiles = (...ids: string[]) =>
  ids.map((id) => TILES.find((tile) => tile.id === id)!);

function included(...ticked: string[]) {
  return Object.fromEntries(
    [...includedTiles(tiles(...ticked))].map(([id, parents]) => [
      id,
      parents.map((parent) => parent.id),
    ]),
  );
}

test('includes a metric whose bulk data a ticked metric already reads', () => {
  assert.deepEqual(included('review'), { detectorOutput: ['review'] });
  assert.deepEqual(included('chainLinking'), {
    homographies: ['chainLinking'],
    setHomographies: ['chainLinking'],
  });
  assert.deepEqual(included('setHomographies'), {
    homographies: ['setHomographies'],
    chainLinking: ['setHomographies'],
  });
});

test('never adds a metric that would read more bulk data', () => {
  assert.deepEqual(included('detectorOutput'), {});
  assert.deepEqual(included('homographies'), {});
  assert.deepEqual(included('overview', 'detectionModels', 'setLaunches'), {});
  assert.deepEqual(
    included('detectorOutput', 'chainLinking').review,
    undefined,
  );
});

test('includes a metric covered by several ticked metrics together', () => {
  assert.deepEqual(included('homographies', 'review'), {
    detectorOutput: ['review'],
    setHomographies: ['homographies', 'review'],
    chainLinking: ['homographies', 'review'],
  });
});

test('keeps one of two metrics that cover each other unlocked', () => {
  assert.deepEqual(included('setHomographies', 'chainLinking'), {
    homographies: ['chainLinking'],
    setHomographies: ['chainLinking'],
  });
  assert.deepEqual(
    Object.keys(included(...TILES.map((tile) => tile.id))).sort(),
    ['detectorOutput', 'homographies', 'setHomographies'],
  );
});

test('only offers what is passed as offered', () => {
  const surveyWide = TILES.filter((tile) => !tile.needsSet);
  assert.deepEqual(
    [...includedTiles(tiles('homographies'), surveyWide).keys()],
    [],
  );
});
