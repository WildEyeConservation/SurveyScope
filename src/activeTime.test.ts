import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * The accumulation rule used by useActiveTimeTracker, extracted so it can be
 * exercised without a DOM. The hook wires the same rule to pointer, key and
 * wheel events.
 */
function accumulate(
  gapsMs: number[],
  idleGapMs: number
): number {
  let total = 0;
  for (const gap of gapsMs) {
    if (gap > 0 && gap <= idleGapMs) total += gap;
  }
  return total;
}

test('counts working gaps and drops idle ones', () => {
  // Three seconds of steady work, a five minute break, then two more seconds.
  const total = accumulate([1_000, 2_000, 300_000, 2_000], 90_000);
  assert.equal(total, 5_000);
});

test('a task worked steadily is measured in full', () => {
  const steady = Array.from({ length: 60 }, () => 30_000);
  assert.equal(accumulate(steady, 90_000), 1_800_000);
});

test('an unattended session accumulates nothing', () => {
  assert.equal(accumulate([600_000, 600_000], 90_000), 0);
});

test('a gap exactly on the threshold still counts as work', () => {
  assert.equal(accumulate([90_000], 90_000), 90_000);
  assert.equal(accumulate([90_001], 90_000), 0);
});
