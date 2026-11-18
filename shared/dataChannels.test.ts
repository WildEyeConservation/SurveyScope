import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  channelsFor,
  EPOCH_LEAD_MS,
  EPOCH_MS,
  joinableEpochs,
} from './dataChannels';

test('hidden queues are published only to the admin channel', () => {
  assert.deepEqual(channelsFor('Queue', { projectId: 'p1' }, 7), [
    '/data/Queue/projectId/p1/7',
  ]);
  assert.deepEqual(channelsFor('Queue', { projectId: 'p1', hidden: true }, 7), [
    '/data/Queue/adminProjectId/p1/7',
  ]);
});

test('subscribers may join only the current window, or the next one shortly before it', () => {
  const start = 1000 * EPOCH_MS;
  assert.deepEqual(joinableEpochs(start + EPOCH_MS / 2, 0), [1000]);
  assert.deepEqual(
    joinableEpochs(start + EPOCH_MS - EPOCH_LEAD_MS + 1, 0).sort(
      (a, b) => a - b,
    ),
    [1000, 1001],
  );
  assert.deepEqual(
    joinableEpochs(start + 5_000, 10_000).sort((a, b) => a - b),
    [999, 1000],
  );
});
