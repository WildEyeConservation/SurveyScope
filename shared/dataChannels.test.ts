import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  channelsFor,
  EPOCH_LEAD_MS,
  EPOCH_MS,
  joinableEpochs,
  REVOCATION_MS,
  SKEW_MS,
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

test('a joined window ends within the revocation bound', () => {
  const start = 1000 * EPOCH_MS;
  // The earliest moment the next window is accepted.
  let earliest = start;
  for (let t = start; t < start + EPOCH_MS; t += 1000) {
    if (joinableEpochs(t).includes(1001)) {
      earliest = t;
      break;
    }
  }
  assert.ok(earliest > start);
  assert.ok(start + 2 * EPOCH_MS - earliest <= REVOCATION_MS);
  assert.ok(EPOCH_MS + EPOCH_LEAD_MS + SKEW_MS <= REVOCATION_MS);
});
