import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countSuggestedPointsKept,
  finalizeHomographyTask,
  homographyWorkflowTask,
} from './homographyWorkflowStats';

const points = {
  p1: [{ id: 'suggested-0' }, { id: 'manual-1' }, { id: 'suggested-2' }],
  p2: [{ id: 'suggested-0' }, { id: 'manual-1' }, { id: 'suggested-3' }],
};
const input = {
  runId: 'run',
  pairKey: 'a:b',
  skipped: false,
  points,
  activeTimeMs: 12000,
  waitingTimeMs: 500,
};

test('saved pairs count complete point pairs and only matched suggested IDs', () => {
  assert.equal(countSuggestedPointsKept(points), 1);
  const task = homographyWorkflowTask(input);
  assert.deepEqual(task.metrics, {
    saved: 1,
    controlPointPairs: 3,
    suggestedPointsRetained: 1,
  });
  assert.equal(task.skipped, false);
  assert.equal(task.activeTimeMs, 12000);
  assert.equal(task.waitingTimeMs, 500);
  assert.equal(countSuggestedPointsKept({ p1: points.p1, p2: [] }), 0);
});

test('skipping records its outcome and time without crediting discarded points', () => {
  const task = homographyWorkflowTask({ ...input, skipped: true });
  assert.equal(task.outcome, 'skipped');
  assert.equal(task.skipped, true);
  assert.equal(task.activeTimeMs, 12000);
  assert.deepEqual(task.metrics, {
    saved: 0,
    controlPointPairs: 0,
    suggestedPointsRetained: 0,
  });
  assert.equal(
    task.idempotencyKey,
    homographyWorkflowTask(input).idempotencyKey,
  );
});

test('API errors, including partial data, cannot count or acknowledge a decision', async () => {
  for (const response of [
    {},
    { data: { id: 'pair' }, errors: [{ message: 'save failed' }] },
  ]) {
    const effects: string[] = [];
    await assert.rejects(
      finalizeHomographyTask({
        persist: async () => response,
        progress: { counted: false },
        incrementCount: async () => {
          effects.push('count');
          return {};
        },
        recordStatistics: async () => {
          effects.push('statistics');
        },
        acknowledge: async () => {
          effects.push('ack');
        },
      }),
    );
    assert.deepEqual(effects, []);
  }
});

test('a failed acknowledgement can retry without advancing queue progress twice', async () => {
  const effects: string[] = [];
  let failAck = true;
  const options = {
    persist: async () => {
      effects.push('save');
      return { data: {} };
    },
    progress: { counted: false },
    incrementCount: async () => {
      effects.push('count');
      return {};
    },
    recordStatistics: async () => {
      effects.push('statistics');
    },
    acknowledge: async () => {
      effects.push('ack');
      if (failAck) throw new Error('ack failed');
    },
  };
  await assert.rejects(finalizeHomographyTask(options), /ack failed/);
  failAck = false;
  await finalizeHomographyTask(options);
  assert.deepEqual(effects, [
    'save',
    'count',
    'statistics',
    'ack',
    'save',
    'statistics',
    'ack',
  ]);
});
