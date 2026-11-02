import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialPlannerState,
  MAX_PREFETCH,
  planPrefetch,
  type PlannerState,
  type TaskSample,
} from './prefetchPlanner';

const run = (samples: TaskSample[], state: PlannerState = initialPlannerState()) =>
  samples.reduce((s, sample) => planPrefetch(s, sample, 2), state);
const repeat = (sample: TaskSample, times: number) => Array(times).fill(sample);

test('a fast user who keeps waiting gets a deeper prefetch, one step at a time', () => {
  const sample = { timeTakenMs: 600, waitingMs: 1500, loadMs: 3000, slotWaitMs: 50 };
  const once = run([sample]);
  assert.equal(once.depth, 2);
  // 3000 / 600 + 1 - 2 mounted = 4 more tasks.
  assert.equal(run(repeat(sample, 20)).depth, 4);
});

test('depth does not grow when the user is not waiting', () => {
  const sample = { timeTakenMs: 600, waitingMs: 0, loadMs: 3000, slotWaitMs: 50 };
  assert.equal(run(repeat(sample, 20)).depth, 1);
});

test('depth shrinks when slow users no longer need it', () => {
  const deep = run(repeat({ timeTakenMs: 300, waitingMs: 2000, loadMs: 6000, slotWaitMs: 0 }, 40));
  assert.equal(deep.depth, MAX_PREFETCH);
  const slow = run(repeat({ timeTakenMs: 20_000, waitingMs: 0, loadMs: 2000, slotWaitMs: 0 }, 40), deep);
  assert.equal(slow.depth, 0);
});

test('backs off when requests queue for a slot', () => {
  const deep = run(repeat({ timeTakenMs: 300, waitingMs: 2000, loadMs: 6000, slotWaitMs: 0 }, 40));
  const saturated = run(repeat({ timeTakenMs: 300, waitingMs: 2000, loadMs: 6000, slotWaitMs: 4000 }, 3), deep);
  assert.ok(saturated.depth < deep.depth);
});

test('cache-only tasks keep the last measured load time', () => {
  const measured = run([{ timeTakenMs: 600, waitingMs: 500, loadMs: 3000, slotWaitMs: 0 }]);
  const cached = run([{ timeTakenMs: 600, waitingMs: 0, loadMs: 0, slotWaitMs: 0 }], measured);
  assert.equal(cached.loadMs, 3000);
});
