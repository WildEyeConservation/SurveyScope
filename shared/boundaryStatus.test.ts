import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  createBoundaryClassifier,
  createStratumAssigner,
  isOnEffort,
  type LatLngRing,
} from './boundaryStatus.ts';

// Roughly 1.1 km square near the equator.
const square: LatLngRing = [
  [0, 0],
  [0, 0.01],
  [0.01, 0.01],
  [0.01, 0],
];
const hole: LatLngRing = [
  [0.004, 0.004],
  [0.004, 0.006],
  [0.006, 0.006],
  [0.006, 0.004],
];

test('classifies inside, outside and excluded positions', () => {
  const classify = createBoundaryClassifier({
    boundary: square,
    exclusions: [hole],
    marginM: 0,
  });
  assert.equal(classify(0.002, 0.002), 'inside');
  assert.equal(classify(0.005, 0.005), 'excluded');
  assert.equal(classify(0.02, 0.005), 'outside');
  assert.equal(classify(null, 0.005), null);
  assert.equal(classify(Number.NaN, 0.005), null);
});

test('positions within the margin count as inside', () => {
  // 0.0005 deg of longitude is about 56 m at the equator.
  const point = [0.005, 0.0105] as const;
  const strict = createBoundaryClassifier({
    boundary: square,
    exclusions: [],
    marginM: 0,
  });
  const lenient = createBoundaryClassifier({
    boundary: square,
    exclusions: [],
    marginM: 60,
  });
  const tight = createBoundaryClassifier({
    boundary: square,
    exclusions: [],
    marginM: 50,
  });
  assert.equal(strict(...point), 'outside');
  assert.equal(lenient(...point), 'inside');
  assert.equal(tight(...point), 'outside');
});

test('without a boundary only exclusions apply', () => {
  const classify = createBoundaryClassifier({
    boundary: null,
    exclusions: [hole],
    marginM: 0,
  });
  assert.equal(classify(5, 5), 'inside');
  assert.equal(classify(0.005, 0.005), 'excluded');
});

test('a closed ring classifies like an open one', () => {
  const classify = createBoundaryClassifier({
    boundary: [...square, square[0]],
    exclusions: [],
    marginM: 0,
  });
  assert.equal(classify(0.002, 0.002), 'inside');
  assert.equal(classify(0.02, 0.002), 'outside');
});

test('missing status is on effort', () => {
  assert.equal(isOnEffort(null), true);
  assert.equal(isOnEffort(undefined), true);
  assert.equal(isOnEffort('inside'), true);
  assert.equal(isOnEffort('outside'), false);
  assert.equal(isOnEffort('excluded'), false);
});

test('points on an edge or vertex count as inside it', () => {
  const classify = createBoundaryClassifier({
    boundary: square,
    exclusions: [hole],
    marginM: 0,
  });
  for (const point of [
    [0, 0.005],
    [0.01, 0.005],
    [0.005, 0],
    [0.005, 0.01],
    [0, 0],
    [0.01, 0.01],
  ] as const) {
    assert.equal(classify(...point), 'inside', point.join(','));
  }
  for (const point of [
    [0.004, 0.005],
    [0.006, 0.005],
    [0.005, 0.004],
    [0.005, 0.006],
    [0.006, 0.006],
  ] as const) {
    assert.equal(classify(...point), 'excluded', point.join(','));
  }
});

test('points take the stratum they are in, else the nearest one', () => {
  const east: LatLngRing = [
    [0, 0.01],
    [0, 0.02],
    [0.01, 0.02],
    [0.01, 0.01],
  ];
  const assign = createStratumAssigner([square, null, east]);
  assert.equal(assign(0.005, 0.005), 0);
  assert.equal(assign(0.005, 0.015), 2);
  assert.equal(assign(0.005, 0.03), 2);
  assert.equal(assign(-0.001, 0.002), 0);
});

test('a single stratum without a shape takes every point', () => {
  assert.equal(createStratumAssigner([null])(5, 5), 0);
  assert.equal(createStratumAssigner([null, null])(5, 5), null);
});
