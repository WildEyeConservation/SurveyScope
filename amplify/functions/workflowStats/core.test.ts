import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORKFLOW_REGISTRY,
  WORKFLOW_TYPES,
} from '../../../shared/workflowStats';
import {
  buildCreateWorkflowRunPut,
  buildRecordWorkflowTaskEventTransaction,
  parseRecordWorkflowTaskEventInput,
  parseWorkflowActor,
  prepareWorkflowTaskEvent,
} from './core';

const actor = parseWorkflowActor({
  userId: 'user-1',
  organizationId: 'organization-1',
});

const rawTask = {
  idempotencyKey: 'queue-message:message-1',
  workflowType: 'species-labelling',
  workflowRunId: 'queue-1',
  projectId: 'project-1',
  annotationSetId: 'set-1',
  workItemType: 'location',
  workItemId: 'location-1',
  startedAt: '2026-08-06T10:00:00.000Z',
  activeTimeMs: 12_000,
  waitingTimeMs: 500,
  outcome: 'sighting',
  metrics: {
    annotationsAdded: 3,
    sightings: 1,
    annotationTimeMs: 12_000,
  },
};

test('registry defines every stable workflow type', () => {
  assert.deepEqual(Object.keys(WORKFLOW_REGISTRY).sort(), [...WORKFLOW_TYPES].sort());
});

test('builds a durable workflow run without trusting an organization from input', () => {
  const put = buildCreateWorkflowRunPut(
    {
      runId: 'queue-1',
      workflowType: 'species-labelling',
      projectId: 'project-1',
      annotationSetId: 'set-1',
      displayName: 'August labelling run',
      organizationId: 'spoofed-organization',
      configuration: { locationSetId: 'locations-1' },
    },
    actor,
    'Runs',
    new Date('2026-08-06T09:00:00.000Z')
  );

  assert.equal(put.TableName, 'Runs');
  assert.equal(put.Item?.organizationId, 'organization-1');
  assert.equal(put.Item?.status, 'active');
  assert.equal(put.ConditionExpression, 'attribute_not_exists(#runId)');
});

test('parses a workflow-specific task and rejects unsupported metrics', () => {
  const parsed = parseRecordWorkflowTaskEventInput(rawTask);
  assert.equal(parsed.workflowType, 'species-labelling');
  assert.equal(parsed.metrics?.annotationsAdded, 3);

  assert.throws(
    () =>
      parseRecordWorkflowTaskEventInput({
        ...rawTask,
        metrics: { linksCreated: 1 },
      }),
    /not supported/
  );
});

test('derives a stable event id and digest independent of metric insertion order', () => {
  const first = prepareWorkflowTaskEvent(
    parseRecordWorkflowTaskEventInput(rawTask),
    actor,
    {
      completedAt: '2026-08-06T10:00:12.000Z',
      recordedAt: new Date('2026-08-06T10:01:00.000Z'),
    }
  );
  const second = prepareWorkflowTaskEvent(
    parseRecordWorkflowTaskEventInput({
      ...rawTask,
      metrics: {
        sightings: 1,
        annotationTimeMs: 12_000,
        annotationsAdded: 3,
      },
    }),
    actor,
    {
      completedAt: '2026-08-06T10:00:12.000Z',
      recordedAt: new Date('2026-08-06T10:02:00.000Z'),
    }
  );

  assert.equal(first.eventId, second.eventId);
  assert.equal(first.inputDigest, second.inputDigest);
  assert.equal(
    first.dailyScopeKey,
    'PROJECT#project-1#SET#set-1#WORKFLOW#species-labelling'
  );
  assert.equal(
    first.dailyBucketKey,
    'DATE#2026-08-06#USER#user-1#RUN#queue-1'
  );
});

test('server completion time does not change retry identity', () => {
  const input = parseRecordWorkflowTaskEventInput({
    ...rawTask,
    startedAt: undefined,
  });
  const first = prepareWorkflowTaskEvent(input, actor, {
    recordedAt: new Date('2026-08-06T23:59:59.000Z'),
  });
  const retry = prepareWorkflowTaskEvent(input, actor, {
    recordedAt: new Date('2026-08-07T00:00:01.000Z'),
  });

  assert.equal(first.eventId, retry.eventId);
  assert.equal(first.inputDigest, retry.inputDigest);
  assert.notEqual(first.dailyBucketKey, retry.dailyBucketKey);
});

test('builds one atomic run check, immutable event put, and additive projection', () => {
  const input = parseRecordWorkflowTaskEventInput(rawTask);
  const prepared = prepareWorkflowTaskEvent(input, actor, {
    completedAt: '2026-08-06T10:00:12.000Z',
    recordedAt: new Date('2026-08-06T10:01:00.000Z'),
  });
  const transaction = buildRecordWorkflowTaskEventTransaction(
    input,
    actor,
    prepared,
    { runs: 'Runs', events: 'Events', dailyStats: 'DailyStats' }
  );

  assert.equal(transaction.TransactItems?.length, 3);
  assert.equal(transaction.TransactItems?.[0]?.ConditionCheck?.TableName, 'Runs');
  assert.equal(transaction.TransactItems?.[1]?.Put?.TableName, 'Events');
  assert.equal(
    transaction.TransactItems?.[1]?.Put?.ConditionExpression,
    'attribute_not_exists(#eventId)'
  );
  const update = transaction.TransactItems?.[2]?.Update;
  assert.equal(update?.TableName, 'DailyStats');
  assert.match(update?.UpdateExpression ?? '', /ADD #completedUnits :one/);
  assert.ok(
    Object.values(update?.ExpressionAttributeNames ?? {}).includes(
      'metric_annotationsAdded'
    )
  );
});

test('rejects impossible timing and untrusted actor shapes', () => {
  const input = parseRecordWorkflowTaskEventInput(rawTask);
  assert.throws(
    () =>
      prepareWorkflowTaskEvent(input, actor, {
        completedAt: '2026-08-06T09:59:59.000Z',
      }),
    /startedAt cannot be after completedAt/
  );
  assert.throws(() => parseWorkflowActor({ userId: 'user-1' }), /organizationId/);
});
