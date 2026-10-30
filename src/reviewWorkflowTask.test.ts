import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewWorkflowTask } from './reviewWorkflowTask';

const base = {
  queueId: 'review-run',
  annotationId: 'animal-1',
  originalCategoryId: 'elephant',
  reviewCategoryId: 'elephant',
  falsePositive: false,
  visibleAt: 1000,
  readyAt: 3000,
  submittedAt: 8000,
};

test('each review decision contributes exactly one allowed outcome metric', () => {
  for (const [change, outcome, metric] of [
    [{}, 'approved', 'approved'],
    [{ reviewCategoryId: 'buffalo' }, 'relabelled', 'relabelled'],
    [
      { reviewCategoryId: 'new-fp-category', falsePositive: true },
      'false-positive',
      'falsePositive',
    ],
  ] as const) {
    const task = reviewWorkflowTask({ ...base, ...change });
    assert.equal(task.outcome, outcome);
    assert.equal(task.metrics?.[metric], 1);
    assert.equal(
      Object.values(task.metrics!).reduce((a, b) => a + b, 0),
      1,
    );
  }
});

test('review timing excludes preloading and separates waiting from work', () => {
  assert.equal(reviewWorkflowTask(base).waitingTimeMs, 2000);
  assert.equal(reviewWorkflowTask(base).activeTimeMs, 5000);
  const preloaded = reviewWorkflowTask({ ...base, readyAt: 500 });
  assert.equal(preloaded.waitingTimeMs, 0);
  assert.equal(preloaded.activeTimeMs, 7000);
  const notReady = reviewWorkflowTask({ ...base, readyAt: null });
  assert.equal(notReady.activeTimeMs, 0);
  assert.equal(notReady.waitingTimeMs, 7000);
  const hidden = reviewWorkflowTask({ ...base, visibleAt: null });
  assert.equal(hidden.activeTimeMs, 0);
  assert.equal(hidden.waitingTimeMs, 0);
  assert.equal(
    reviewWorkflowTask({ ...base, submittedAt: 3_000_000 }).activeTimeMs,
    900_000,
  );
});

test('undo and redelivery keep the same event identity; a new run counts separately', () => {
  const eventId = (changes: Partial<typeof base>) => {
    const task = reviewWorkflowTask({ ...base, ...changes });
    return `${task.workflowRunId}:${task.idempotencyKey}`;
  };
  assert.equal(
    eventId({}),
    eventId({ reviewCategoryId: 'buffalo', submittedAt: 9000 }),
  );
  assert.notEqual(eventId({}), eventId({ queueId: 'another-run' }));
});
