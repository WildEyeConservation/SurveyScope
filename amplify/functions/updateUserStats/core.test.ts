import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildQueueTransaction,
  buildStatsTransaction,
  queueReceiptId,
  statsDeltaFromObservation,
  statsReceiptId,
} from './core';

const observation = {
  id: 'observation-1',
  annotationSetId: 'set-1',
  createdAt: '2026-08-06T14:15:16.000Z',
  owner: 'identity-id::user-1',
  projectId: 'project-1',
  group: 'org-1',
  queueId: 'queue-1',
  annotationCount: 3,
  timeTaken: 45_000,
  waitingTime: 2_000,
};

test('derives the daily stats key and sighting counters from an observation', () => {
  assert.deepEqual(statsDeltaFromObservation(observation), {
    observationId: 'observation-1',
    setId: 'set-1',
    date: '2026-08-06',
    userId: 'user-1',
    projectId: 'project-1',
    organizationId: 'org-1',
    observationCount: 1,
    annotationCount: 3,
    sightingCount: 1,
    activeTime: 45_000,
    searchTime: 0,
    searchCount: 0,
    annotationTime: 45_000,
    waitingTime: 2_000,
    queueId: 'queue-1',
  });
});

test('accepts an owner without the identity prefix', () => {
  const delta = statsDeltaFromObservation({
    ...observation,
    owner: 'user-2',
    annotationCount: 0,
  });
  assert.equal(delta.userId, 'user-2');
  assert.equal(delta.searchCount, 1);
  assert.equal(delta.sightingCount, 0);
});

test('rejects invalid required fields and dates', () => {
  assert.throws(
    () => statsDeltaFromObservation({ ...observation, projectId: '' }),
    /missing required field projectId/
  );
  assert.throws(
    () => statsDeltaFromObservation({ ...observation, createdAt: 'invalid' }),
    /invalid createdAt/
  );
});

test('floors negative counters and times and drops times over the cap', () => {
  const negative = statsDeltaFromObservation({
    ...observation,
    annotationCount: -4,
    timeTaken: -100,
    waitingTime: -200,
  });
  assert.equal(negative.annotationCount, 0);
  assert.equal(negative.activeTime, 0);
  assert.equal(negative.waitingTime, 0);

  const overCap = statsDeltaFromObservation({
    ...observation,
    annotationCount: 0,
    timeTaken: 120_001,
  });
  assert.equal(overCap.activeTime, 0);
  assert.equal(overCap.searchTime, 0);
});

test('uses separate stable receipt ids for each side effect', () => {
  assert.equal(statsReceiptId('event-1'), 'stats:event-1');
  assert.equal(queueReceiptId('event-1'), 'queue:event-1');
});

test('builds an atomic receipt and additive UserStats update', () => {
  const now = new Date('2026-08-06T15:00:00.000Z');
  const transaction = buildStatsTransaction(
    'event-1',
    statsDeltaFromObservation(observation),
    { receipts: 'receipts-table', userStats: 'stats-table' },
    now
  );
  const receipt = transaction.TransactItems?.[0]?.Put;
  const update = transaction.TransactItems?.[1]?.Update;

  assert.equal(receipt?.TableName, 'receipts-table');
  assert.equal(receipt?.Item?.id, 'stats:event-1');
  assert.equal(receipt?.ConditionExpression, 'attribute_not_exists(#id)');
  assert.deepEqual(update?.Key, {
    projectId: 'project-1',
    'userId#date#setId': 'user-1#2026-08-06#set-1',
  });
  assert.equal(
    update?.UpdateExpression,
    'SET #date = if_not_exists(#date, :date), #userId = if_not_exists(#userId, :userId), #setId = if_not_exists(#setId, :setId), #typeName = if_not_exists(#typeName, :typeName), #createdAt = if_not_exists(#createdAt, :createdAt), #updatedAt = :updatedAt, #group = :group ADD #observationCount :observationCount, #annotationCount :annotationCount, #sightingCount :sightingCount, #activeTime :activeTime, #searchTime :searchTime, #searchCount :searchCount, #annotationTime :annotationTime, #waitingTime :waitingTime'
  );
  assert.equal(update?.ExpressionAttributeValues?.[':annotationCount'], 3);
  assert.equal(update?.ExpressionAttributeValues?.[':group'], 'org-1');
});

test('builds an idempotent conditional Queue increment', () => {
  const transaction = buildQueueTransaction(
    'event-1',
    'observation-1',
    'queue-1',
    { receipts: 'receipts-table', queues: 'queues-table' },
    new Date('2026-08-06T15:00:00.000Z')
  );
  const update = transaction.TransactItems?.[1]?.Update;

  assert.equal(transaction.TransactItems?.[0]?.Put?.Item?.id, 'queue:event-1');
  assert.equal(update?.TableName, 'queues-table');
  assert.deepEqual(update?.Key, { id: 'queue-1' });
  assert.equal(update?.ConditionExpression, 'attribute_exists(#id)');
  assert.equal(
    update?.UpdateExpression,
    'SET #lastObservationAt = :now ADD #observedCount :one'
  );
});
