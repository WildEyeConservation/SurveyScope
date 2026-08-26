import { createHash } from 'node:crypto';
import type {
  PutCommandInput,
  TransactWriteCommandInput,
  UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  isMetricAllowed,
  isWorkflowType,
  type WorkflowMetricKey,
  type WorkflowType,
} from '../../../shared/workflowStats';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export interface WorkflowActor {
  userId: string;
  organizationId: string;
}

export interface CreateWorkflowRunInput {
  runId: string;
  workflowType: WorkflowType;
  projectId: string;
  annotationSetId: string;
  displayName: string;
  configuration?: Record<string, unknown>;
}

export interface RecordWorkflowTaskEventInput {
  idempotencyKey: string;
  workflowType: WorkflowType;
  workflowRunId: string;
  projectId: string;
  annotationSetId: string;
  workItemType: string;
  workItemId: string;
  startedAt?: string;
  activeTimeMs?: number;
  waitingTimeMs?: number;
  outcome: string;
  skipped?: boolean;
  metrics?: Partial<Record<WorkflowMetricKey, number>>;
}

export interface PrepareWorkflowTaskEventOptions {
  completedAt?: string;
  recordedAt?: Date;
}

export interface PreparedWorkflowTaskEvent {
  eventId: string;
  inputDigest: string;
  eventItem: Record<string, unknown>;
  dailyScopeKey: string;
  dailyBucketKey: string;
  metricTotals: Readonly<Record<string, number>>;
  completedAt: string;
  recordedAt: string;
}

export interface WorkflowStatsTables {
  runs: string;
  events: string;
  dailyStats: string;
}

export function buildCreateWorkflowRunPut(
  value: unknown,
  actor: WorkflowActor,
  tableName: string,
  launchedAt = new Date()
): PutCommandInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('run must be an object');
  }
  const input = value as Record<string, unknown>;
  if (!isWorkflowType(input.workflowType)) {
    throw new Error('workflowType is not supported');
  }
  if (
    input.configuration !== undefined &&
    (!input.configuration ||
      typeof input.configuration !== 'object' ||
      Array.isArray(input.configuration))
  ) {
    throw new Error('configuration must be an object');
  }
  const configuration = input.configuration as
    | Record<string, unknown>
    | undefined;
  if (configuration && JSON.stringify(configuration).length > 100_000) {
    throw new Error('configuration must be at most 100000 serialized characters');
  }

  return {
    TableName: tableName,
    Item: {
      runId: requiredIdentifier(input.runId, 'runId'),
      workflowType: input.workflowType,
      projectId: requiredIdentifier(input.projectId, 'projectId'),
      annotationSetId: requiredIdentifier(
        input.annotationSetId,
        'annotationSetId'
      ),
      organizationId: actor.organizationId,
      displayName: requiredIdentifier(input.displayName, 'displayName'),
      configuration,
      status: 'active',
      launchedAt: launchedAt.toISOString(),
      createdBy: actor.userId,
      createdAt: launchedAt.toISOString(),
      updatedAt: launchedAt.toISOString(),
    },
    ConditionExpression: 'attribute_not_exists(#runId)',
    ExpressionAttributeNames: { '#runId': 'runId' },
  };
}

export type WorkflowRunFinishStatus = 'completed' | 'cancelled';

/** Why a run left the active state; kept alongside status for reporting. */
export type WorkflowRunFinishReason =
  | 'drained'
  | 'requeue-limit'
  | 'stale'
  | 'user'
  | 'backfill';

export interface FinishWorkflowRunInput {
  runId: string;
  status: WorkflowRunFinishStatus;
  reason: WorkflowRunFinishReason;
  finishedBy?: string;
  launchedCount?: number;
  observedCount?: number;
}

// Only an active run can finish, so a late duplicate (cleanup and a manual
// cancel racing, or a replayed stream record) leaves the first outcome intact.
export function buildFinishWorkflowRunUpdate(
  input: FinishWorkflowRunInput,
  tableName: string,
  finishedAt = new Date()
): UpdateCommandInput {
  if (input.status !== 'completed' && input.status !== 'cancelled') {
    throw new Error('status must be completed or cancelled');
  }
  const names: Record<string, string> = {
    '#runId': 'runId',
    '#status': 'status',
    '#finishedAt': 'finishedAt',
    '#finishReason': 'finishReason',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, string | number> = {
    ':active': 'active',
    ':status': input.status,
    ':finishedAt': finishedAt.toISOString(),
    ':finishReason': input.reason,
  };
  const sets = [
    '#status = :status',
    '#finishedAt = :finishedAt',
    '#finishReason = :finishReason',
    '#updatedAt = :finishedAt',
  ];
  if (input.finishedBy) {
    names['#finishedBy'] = 'finishedBy';
    values[':finishedBy'] = requiredIdentifier(input.finishedBy, 'finishedBy');
    sets.push('#finishedBy = :finishedBy');
  }
  for (const key of ['launchedCount', 'observedCount'] as const) {
    const count = input[key];
    if (count === undefined) continue;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
    names[`#${key}`] = key;
    values[`:${key}`] = count;
    sets.push(`#${key} = :${key}`);
  }
  return {
    TableName: tableName,
    Key: { runId: requiredIdentifier(input.runId, 'runId') },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: 'attribute_exists(#runId) AND #status = :active',
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

function requiredIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new Error(`${field} must be a non-empty string of at most ${MAX_IDENTIFIER_LENGTH} characters`);
  }
  return value;
}

function requiredToken(value: unknown, field: string): string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw new Error(`${field} must match ${TOKEN_PATTERN}`);
  }
  return value;
}

function duration(value: unknown, field: string): number {
  const parsed = value ?? 0;
  if (
    typeof parsed !== 'number' ||
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > MAX_DURATION_MS
  ) {
    throw new Error(`${field} must be between 0 and ${MAX_DURATION_MS}`);
  }
  return Math.round(parsed);
}

function metricValue(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function isoTimestamp(value: string, field: string): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${field} must be an ISO-8601 timestamp`);
  }
  return timestamp.toISOString();
}

function stableMetrics(
  workflowType: WorkflowType,
  metrics: Record<string, unknown> | undefined
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const key of Object.keys(metrics ?? {}).sort()) {
    if (!isMetricAllowed(workflowType, key)) {
      throw new Error(`Metric ${key} is not supported by ${workflowType}`);
    }
    normalized[key] = metricValue(metrics?.[key], `metrics.${key}`);
  }
  return normalized;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function parseRecordWorkflowTaskEventInput(
  value: unknown
): RecordWorkflowTaskEventInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('task must be an object');
  }
  const input = value as Record<string, unknown>;
  if (!isWorkflowType(input.workflowType)) {
    throw new Error('workflowType is not supported');
  }

  const metrics = stableMetrics(
    input.workflowType,
    input.metrics && typeof input.metrics === 'object' && !Array.isArray(input.metrics)
      ? (input.metrics as Record<string, unknown>)
      : input.metrics === undefined
        ? undefined
        : (() => {
            throw new Error('metrics must be an object');
          })()
  );

  return {
    idempotencyKey: requiredIdentifier(input.idempotencyKey, 'idempotencyKey'),
    workflowType: input.workflowType,
    workflowRunId: requiredIdentifier(input.workflowRunId, 'workflowRunId'),
    projectId: requiredIdentifier(input.projectId, 'projectId'),
    annotationSetId: requiredIdentifier(input.annotationSetId, 'annotationSetId'),
    workItemType: requiredToken(input.workItemType, 'workItemType'),
    workItemId: requiredIdentifier(input.workItemId, 'workItemId'),
    startedAt:
      input.startedAt === undefined
        ? undefined
        : isoTimestamp(requiredIdentifier(input.startedAt, 'startedAt'), 'startedAt'),
    activeTimeMs: duration(input.activeTimeMs, 'activeTimeMs'),
    waitingTimeMs: duration(input.waitingTimeMs, 'waitingTimeMs'),
    outcome: requiredToken(input.outcome, 'outcome'),
    skipped: input.skipped === true,
    metrics,
  };
}

export function parseWorkflowActor(value: unknown): WorkflowActor {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('actor must be an object');
  }
  const actor = value as Record<string, unknown>;
  return {
    userId: requiredIdentifier(actor.userId, 'actor.userId'),
    organizationId: requiredIdentifier(
      actor.organizationId,
      'actor.organizationId'
    ),
  };
}

export function prepareWorkflowTaskEvent(
  input: RecordWorkflowTaskEventInput,
  actor: WorkflowActor,
  options: PrepareWorkflowTaskEventOptions = {}
): PreparedWorkflowTaskEvent {
  const recordedAt = (options.recordedAt ?? new Date()).toISOString();
  const completedAt = options.completedAt
    ? isoTimestamp(options.completedAt, 'completedAt')
    : recordedAt;
  if (input.startedAt && input.startedAt > completedAt) {
    throw new Error('startedAt cannot be after completedAt');
  }

  const metricTotals = Object.fromEntries(
    Object.entries(input.metrics ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ) as Record<string, number>;
  const identity = {
    schemaVersion: 1,
    workflowType: input.workflowType,
    workflowRunId: input.workflowRunId,
    idempotencyKey: input.idempotencyKey,
  };
  const eventId = `workflow-event:v1:${sha256(identity)}`;
  const digestPayload = {
    ...identity,
    projectId: input.projectId,
    annotationSetId: input.annotationSetId,
    organizationId: actor.organizationId,
    userId: actor.userId,
    workItemType: input.workItemType,
    workItemId: input.workItemId,
    startedAt: input.startedAt ?? null,
    activeTimeMs: input.activeTimeMs ?? 0,
    waitingTimeMs: input.waitingTimeMs ?? 0,
    outcome: input.outcome,
    skipped: input.skipped === true,
    metrics: metricTotals,
  };
  const inputDigest = sha256(digestPayload);
  const date = completedAt.slice(0, 10);
  const dailyScopeKey = [
    `PROJECT#${input.projectId}`,
    `SET#${input.annotationSetId}`,
    `WORKFLOW#${input.workflowType}`,
  ].join('#');
  const dailyBucketKey = [
    `DATE#${date}`,
    `USER#${actor.userId}`,
    `RUN#${input.workflowRunId}`,
  ].join('#');

  return {
    eventId,
    inputDigest,
    dailyScopeKey,
    dailyBucketKey,
    metricTotals,
    completedAt,
    recordedAt,
    eventItem: {
      eventId,
      schemaVersion: 1,
      inputDigest,
      workflowType: input.workflowType,
      workflowRunId: input.workflowRunId,
      projectId: input.projectId,
      annotationSetId: input.annotationSetId,
      organizationId: actor.organizationId,
      userId: actor.userId,
      workItemType: input.workItemType,
      workItemId: input.workItemId,
      startedAt: input.startedAt,
      completedAt,
      recordedAt,
      date,
      activeTimeMs: input.activeTimeMs ?? 0,
      waitingTimeMs: input.waitingTimeMs ?? 0,
      outcome: input.outcome,
      skipped: input.skipped === true,
      metrics: metricTotals,
    },
  };
}

export function buildRecordWorkflowTaskEventTransaction(
  input: RecordWorkflowTaskEventInput,
  actor: WorkflowActor,
  prepared: PreparedWorkflowTaskEvent,
  tables: WorkflowStatsTables
): TransactWriteCommandInput {
  const names: Record<string, string> = {
    '#workflowType': 'workflowType',
    '#projectId': 'projectId',
    '#annotationSetId': 'annotationSetId',
    '#organizationId': 'organizationId',
    '#userId': 'userId',
    '#date': 'date',
    '#workflowRunId': 'workflowRunId',
    '#createdAt': 'createdAt',
    '#updatedAt': 'updatedAt',
    '#completedUnits': 'completedUnits',
    '#skippedUnits': 'skippedUnits',
    '#activeTimeMs': 'activeTimeMs',
    '#waitingTimeMs': 'waitingTimeMs',
  };
  const values: Record<string, string | number> = {
    ':workflowType': input.workflowType,
    ':projectId': input.projectId,
    ':annotationSetId': input.annotationSetId,
    ':organizationId': actor.organizationId,
    ':userId': actor.userId,
    ':date': prepared.completedAt.slice(0, 10),
    ':workflowRunId': input.workflowRunId,
    ':recordedAt': prepared.recordedAt,
    ':one': 1,
    ':skipped': input.skipped ? 1 : 0,
    ':activeTimeMs': input.activeTimeMs ?? 0,
    ':waitingTimeMs': input.waitingTimeMs ?? 0,
  };
  const addExpressions = [
    '#completedUnits :one',
    '#skippedUnits :skipped',
    '#activeTimeMs :activeTimeMs',
    '#waitingTimeMs :waitingTimeMs',
  ];

  Object.entries(prepared.metricTotals).forEach(([key, value], index) => {
    const name = `#metric${index}`;
    const placeholder = `:metric${index}`;
    names[name] = `metric_${key}`;
    values[placeholder] = value;
    addExpressions.push(`${name} ${placeholder}`);
  });

  return {
    TransactItems: [
      {
        ConditionCheck: {
          TableName: tables.runs,
          Key: { runId: input.workflowRunId },
          ConditionExpression:
            'attribute_exists(#runId) AND #workflowType = :workflowType AND #projectId = :projectId AND #annotationSetId = :annotationSetId AND #organizationId = :organizationId',
          ExpressionAttributeNames: {
            '#runId': 'runId',
            '#workflowType': names['#workflowType'],
            '#projectId': names['#projectId'],
            '#annotationSetId': names['#annotationSetId'],
            '#organizationId': names['#organizationId'],
          },
          ExpressionAttributeValues: {
            ':workflowType': values[':workflowType'],
            ':projectId': values[':projectId'],
            ':annotationSetId': values[':annotationSetId'],
            ':organizationId': values[':organizationId'],
          },
        },
      },
      {
        Put: {
          TableName: tables.events,
          Item: prepared.eventItem,
          ConditionExpression: 'attribute_not_exists(#eventId)',
          ExpressionAttributeNames: { '#eventId': 'eventId' },
        },
      },
      {
        Update: {
          TableName: tables.dailyStats,
          Key: {
            scopeKey: prepared.dailyScopeKey,
            bucketKey: prepared.dailyBucketKey,
          },
          UpdateExpression:
            `SET #workflowType = if_not_exists(#workflowType, :workflowType), ` +
            `#projectId = if_not_exists(#projectId, :projectId), ` +
            `#annotationSetId = if_not_exists(#annotationSetId, :annotationSetId), ` +
            `#organizationId = if_not_exists(#organizationId, :organizationId), ` +
            `#userId = if_not_exists(#userId, :userId), ` +
            `#date = if_not_exists(#date, :date), ` +
            `#workflowRunId = if_not_exists(#workflowRunId, :workflowRunId), ` +
            `#createdAt = if_not_exists(#createdAt, :recordedAt), ` +
            `#updatedAt = :recordedAt ADD ${addExpressions.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      },
    ],
  };
}
