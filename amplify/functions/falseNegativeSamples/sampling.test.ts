import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  coverDelta,
  isCoveredByPrimaryWork,
  isUsableTile,
  sampleDraw,
  sampleTarget,
  stagingThreshold,
} from './sampling';

const tile = { x: 1000, y: 1000, width: 2000, height: 2000 };

test('draws are stable, spread out and depend on the seed', () => {
  assert.equal(sampleDraw('seed', 'tile-1'), sampleDraw('seed', 'tile-1'));
  assert.notEqual(sampleDraw('seed', 'tile-1'), sampleDraw('other', 'tile-1'));
  let under = 0;
  for (let i = 0; i < 20_000; i++) {
    const draw = sampleDraw('seed', `tile-${i}`);
    assert.ok(draw >= 0 && draw < 1);
    if (draw < 0.05) under += 1;
  }
  assert.ok(under > 850 && under < 1150, `expected about 1000, got ${under}`);
});

test('a tile is covered by a touching detection or an annotation inside it', () => {
  const detection = { x: 300, y: 300, width: 64, height: 64 };
  assert.equal(isCoveredByPrimaryWork(tile, [detection], undefined), true);
  assert.equal(isCoveredByPrimaryWork(tile, [], [{ x: 1500, y: 20 }]), true);
  assert.equal(isCoveredByPrimaryWork(tile, [], [{ x: 2500, y: 20 }]), false);
  assert.equal(isCoveredByPrimaryWork(tile, undefined, undefined), false);
});

test('tiles without a real box are not usable', () => {
  assert.equal(isUsableTile(tile), true);
  assert.equal(isUsableTile({ ...tile, x: 0 }), false);
  assert.equal(isUsableTile({ ...tile, width: 0 }), false);
});

test('the target is a share of the unreviewed tiles, at least one', () => {
  assert.equal(sampleTarget(5, 1486, 1486), 74);
  assert.equal(sampleTarget(5, 10, 10), 1);
  assert.equal(sampleTarget(5, 1486, 30), 30);
  assert.equal(sampleTarget(0, 1486, 1486), 0);
  assert.equal(sampleTarget(5, 0, 0), 0);
  assert.equal(sampleTarget(100, 1486, 1400), 1400);
});

test('the staging threshold leaves a margin over the wanted share', () => {
  const first = stagingThreshold(5, 5_000_000, 5_000_000, 5_083_176);
  assert.ok(first > 0.05 && first < 0.06);
  // A top-up draws from the tiles not yet sampled.
  const topUp = stagingThreshold(5, 1000, 950, 1500);
  assert.ok(topUp > 0.05 / 0.95);
  assert.equal(stagingThreshold(5, 1000, 0, 1500), 1);
  assert.equal(stagingThreshold(100, 1000, 1000, 1500), 1);
  assert.equal(stagingThreshold(0, 1000, 1000, 1500), 0);
});

test('covering a reviewed tile takes its result back out of the totals', () => {
  assert.deepEqual(coverDelta({ status: 'pending' }), { coveredCount: 1 });
  assert.deepEqual(coverDelta({ status: 'reviewed', found: 3 }), {
    coveredCount: 1,
    reviewedCount: -1,
    foundCount: -3,
  });
  assert.equal(coverDelta({ status: 'covered' }), null);
});
