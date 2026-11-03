import assert from 'node:assert/strict';
import test from 'node:test';
import { summariseEvents } from './summarise';

const event = (
  userId: string,
  metrics: Record<string, number>,
  skipped = false,
) => ({
  workflowType: 'info-tags',
  userId,
  skipped,
  activeTimeMs: 1000,
  waitingTimeMs: 100,
  metrics,
});

test('events sum per workflow and user', () => {
  const [totals] = summariseEvents([
    event('a', { annotationsProcessed: 2, tagged: 1 }),
    event('a', { annotationsProcessed: 3, tagged: 0 }, true),
  ]);
  assert.deepEqual(totals, {
    workflowType: 'info-tags',
    userId: 'a',
    completedUnits: 2,
    skippedUnits: 1,
    activeTimeMs: 2000,
    waitingTimeMs: 200,
    metrics: { annotationsProcessed: 5, tagged: 1 },
  });
});

test('a missing processed count marks the user total incomplete', () => {
  const [totals] = summariseEvents([
    event('a', { annotationsProcessed: 2 }),
    event('a', {}),
  ]);
  assert.equal(totals.metrics.annotationsProcessed, undefined);
  assert.equal(totals.completedUnits, 2);
});
