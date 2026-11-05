import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrefetchPlanner,
  initialPlannerState,
  MAX_PREFETCH,
  planPrefetch,
  type PlannerState,
  type TaskSample,
} from './prefetchPlanner';

const run = (
  samples: TaskSample[],
  state: PlannerState = initialPlannerState(),
) => samples.reduce((s, sample) => planPrefetch(s, sample, 2), state);
const repeat = (sample: TaskSample, times: number) => Array(times).fill(sample);

test('a fast user who keeps waiting gets a deeper prefetch, one step at a time', () => {
  const sample = {
    timeTakenMs: 600,
    waitingMs: 1500,
    loadMs: 3000,
    slotWaitMs: 50,
  };
  const once = run([sample]);
  assert.equal(once.depth, 4);
  // 3000 / 600 + 1 - 2 mounted = 4, plus one step for the waiting.
  assert.equal(run(repeat(sample, 20)).depth, 5);
});

test('depth grows to the estimate without waiting, but not past it', () => {
  const sample = {
    timeTakenMs: 600,
    waitingMs: 0,
    loadMs: 3000,
    slotWaitMs: 50,
  };
  assert.equal(run(repeat(sample, 20)).depth, 4);
});

test('slow images set the lead when fast ones are mixed in', () => {
  const fast = { timeTakenMs: 400, waitingMs: 0, loadMs: 250, slotWaitMs: 0 };
  const slow = { ...fast, loadMs: 1100 };
  const state = run(
    Array.from({ length: 30 }, (_, i) => (i % 2 ? fast : slow)),
  );
  assert.ok(state.loadMs > 900);
  assert.equal(state.depth, 2);
});

test('a fresh browser starts at three and drops what it does not need', () => {
  const fast = { timeTakenMs: 400, waitingMs: 0, loadMs: 300, slotWaitMs: 0 };
  assert.equal(initialPlannerState().depth, 3);
  assert.deepEqual(
    [1, 2, 3].map((n) => run(repeat(fast, n)).depth),
    [2, 1, 0],
  );
});

test('a pause counts as at most two typical tasks', () => {
  const steady = run(
    repeat({ timeTakenMs: 400, waitingMs: 0, loadMs: 1100, slotWaitMs: 0 }, 20),
  );
  const paused = run(
    [{ timeTakenMs: 60_000, waitingMs: 0, loadMs: 1100, slotWaitMs: 0 }],
    steady,
  );
  assert.ok(paused.taskMs <= steady.taskMs * 1.2 + 1);
  assert.equal(paused.depth, steady.depth);
});

test('depth shrinks when slow users no longer need it', () => {
  const deep = run(
    repeat(
      { timeTakenMs: 300, waitingMs: 2000, loadMs: 6000, slotWaitMs: 0 },
      40,
    ),
  );
  assert.equal(deep.depth, MAX_PREFETCH);
  const slow = run(
    repeat(
      { timeTakenMs: 20_000, waitingMs: 0, loadMs: 2000, slotWaitMs: 0 },
      40,
    ),
    deep,
  );
  assert.equal(slow.depth, 0);
});

test('backs off when requests queue for a slot', () => {
  const deep = run(
    repeat(
      { timeTakenMs: 300, waitingMs: 2000, loadMs: 6000, slotWaitMs: 0 },
      40,
    ),
  );
  const saturated = run(
    repeat(
      { timeTakenMs: 300, waitingMs: 2000, loadMs: 6000, slotWaitMs: 4000 },
      3,
    ),
    deep,
  );
  assert.ok(saturated.depth < deep.depth);
});

test('cache-only tasks keep the last measured load time', () => {
  const measured = run([
    { timeTakenMs: 600, waitingMs: 500, loadMs: 3000, slotWaitMs: 0 },
  ]);
  const cached = run(
    [{ timeTakenMs: 600, waitingMs: 0, loadMs: 0, slotWaitMs: 0 }],
    measured,
  );
  assert.equal(cached.loadMs, 3000);
});

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

test('resumes from saved state and skips the task after opening the queue', () => {
  const storage = memoryStorage();
  const first = createPrefetchPlanner(2, storage);
  const sample = {
    timeTakenMs: 600,
    waitingMs: 0,
    loadMs: 3000,
    slotWaitMs: 0,
  };
  for (let i = 0; i < 10; i++) first.record(sample);
  assert.equal(first.depth(), 4);

  const reopened = createPrefetchPlanner(2, storage);
  assert.equal(reopened.depth(), 4);
  reopened.skipNext();
  reopened.record({
    timeTakenMs: 30_000,
    waitingMs: 0,
    loadMs: 3000,
    slotWaitMs: 0,
  });
  assert.deepEqual(reopened.state(), first.state());
});

test('ignores unreadable saved state', () => {
  const storage = memoryStorage();
  storage.setItem('prefetchPlanner', '{"depth":"deep"}');
  assert.deepEqual(
    createPrefetchPlanner(2, storage).state(),
    initialPlannerState(),
  );
  storage.setItem('prefetchPlanner', 'not json');
  assert.deepEqual(
    createPrefetchPlanner(2, storage).state(),
    initialPlannerState(),
  );
});
