import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

export interface StatsDelta {
  observationId: string;
  setId: string;
  date: string;
  userId: string;
  projectId: string;
  organizationId?: string;
  observationCount: number;
  annotationCount: number;
  sightingCount: number;
  activeTime: number;
  searchTime: number;
  searchCount: number;
  annotationTime: number;
  waitingTime: number;
  queueId?: string;
}

export interface StatsTransactionTables {
  receipts: string;
  userStats: string;
}

export interface QueueTransactionTables {
  receipts: string;
  queues: string;
}

// Longer than DynamoDB Streams retention and the expected retry window, so
// delayed replays remain idempotent.
const RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;

function requiredString(
  input: Record<string, unknown>,
  field: string
): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Observation is missing required field ${field}`);
  }
  return value;
}

function finiteNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function statsDeltaFromObservation(
  input: Record<string, unknown>
): StatsDelta {
  const observationId = requiredString(input, 'id');
  const setId = requiredString(input, 'annotationSetId');
  const createdAt = requiredString(input, 'createdAt');
  const owner = requiredString(input, 'owner');
  const projectId = requiredString(input, 'projectId');
  const date = createdAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Observation ${observationId} has invalid createdAt`);
  }

  const userId = owner.includes('::') ? owner.split('::')[1] : owner;
  if (!userId?.trim()) {
    throw new Error(`Observation ${observationId} has an invalid owner`);
  }

  const annotationCount = Math.max(finiteNumber(input.annotationCount), 0);
  const waitingTime = Math.max(finiteNumber(input.waitingTime), 0);
  const sightingCount = annotationCount > 0 ? 1 : 0;
  let activeTime = Math.max(finiteNumber(input.timeTaken), 0);
  if (
    activeTime >
    (sightingCount > 0 ? 900 * 1000 : 120 * 1000)
  ) {
    activeTime = 0;
  }

  const queueId =
    typeof input.queueId === 'string' && input.queueId.length > 0
      ? input.queueId
      : undefined;
  const organizationId =
    typeof input.group === 'string' && input.group.length > 0
      ? input.group
      : undefined;

  return {
    observationId,
    setId,
    date,
    userId,
    projectId,
    organizationId,
    observationCount: 1,
    annotationCount,
    sightingCount,
    activeTime,
    searchTime: sightingCount > 0 ? 0 : activeTime,
    searchCount: sightingCount > 0 ? 0 : 1,
    annotationTime: sightingCount > 0 ? activeTime : 0,
    waitingTime,
    queueId,
  };
}

function receiptPut(
  tableName: string,
  receiptId: string,
  eventId: string,
  observationId: string,
  now: Date
) {
  return {
    Put: {
      TableName: tableName,
      Item: {
        id: receiptId,
        eventId,
        observationId,
        expiresAt: Math.floor(now.getTime() / 1000) + RECEIPT_TTL_SECONDS,
      },
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: { '#id': 'id' },
    },
  };
}

export function statsReceiptId(eventId: string): string {
  return `stats:${eventId}`;
}

export function queueReceiptId(eventId: string): string {
  return `queue:${eventId}`;
}

export function buildStatsTransaction(
  eventId: string,
  delta: StatsDelta,
  tables: StatsTransactionTables,
  now = new Date()
): TransactWriteCommandInput {
  const receiptId = statsReceiptId(eventId);
  const expressionNames: Record<string, string> = {
    '#date': 'date',
    '#userId': 'userId',
    '#setId': 'setId',
    '#typeName': '__typename',
    '#createdAt': 'createdAt',
    '#updatedAt': 'updatedAt',
    '#observationCount': 'observationCount',
    '#annotationCount': 'annotationCount',
    '#sightingCount': 'sightingCount',
    '#activeTime': 'activeTime',
    '#searchTime': 'searchTime',
    '#searchCount': 'searchCount',
    '#annotationTime': 'annotationTime',
    '#waitingTime': 'waitingTime',
  };
  const expressionValues: Record<string, string | number> = {
    ':date': delta.date,
    ':userId': delta.userId,
    ':setId': delta.setId,
    ':typeName': 'UserStats',
    ':createdAt': now.toISOString(),
    ':updatedAt': now.toISOString(),
    ':observationCount': delta.observationCount,
    ':annotationCount': delta.annotationCount,
    ':sightingCount': delta.sightingCount,
    ':activeTime': delta.activeTime,
    ':searchTime': delta.searchTime,
    ':searchCount': delta.searchCount,
    ':annotationTime': delta.annotationTime,
    ':waitingTime': delta.waitingTime,
  };
  const setExpressions = [
    '#date = if_not_exists(#date, :date)',
    '#userId = if_not_exists(#userId, :userId)',
    '#setId = if_not_exists(#setId, :setId)',
    '#typeName = if_not_exists(#typeName, :typeName)',
    '#createdAt = if_not_exists(#createdAt, :createdAt)',
    '#updatedAt = :updatedAt',
  ];

  if (delta.organizationId) {
    expressionNames['#group'] = 'group';
    expressionValues[':group'] = delta.organizationId;
    // A later valid observation should heal a row created while organization
    // lookup was temporarily unavailable.
    setExpressions.push('#group = :group');
  }

  return {
    TransactItems: [
      receiptPut(
        tables.receipts,
        receiptId,
        eventId,
        delta.observationId,
        now
      ),
      {
        Update: {
          TableName: tables.userStats,
          Key: {
            projectId: delta.projectId,
            'userId#date#setId': `${delta.userId}#${delta.date}#${delta.setId}`,
          },
          UpdateExpression: `SET ${setExpressions.join(', ')} ADD #observationCount :observationCount, #annotationCount :annotationCount, #sightingCount :sightingCount, #activeTime :activeTime, #searchTime :searchTime, #searchCount :searchCount, #annotationTime :annotationTime, #waitingTime :waitingTime`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
        },
      },
    ],
  };
}

export function buildQueueTransaction(
  eventId: string,
  observationId: string,
  queueId: string,
  tables: QueueTransactionTables,
  now = new Date()
): TransactWriteCommandInput {
  return {
    TransactItems: [
      receiptPut(
        tables.receipts,
        queueReceiptId(eventId),
        eventId,
        observationId,
        now
      ),
      {
        Update: {
          TableName: tables.queues,
          Key: { id: queueId },
          UpdateExpression:
            'SET #lastObservationAt = :now ADD #observedCount :one',
          ConditionExpression: 'attribute_exists(#id)',
          ExpressionAttributeNames: {
            '#id': 'id',
            '#lastObservationAt': 'lastObservationAt',
            '#observedCount': 'observedCount',
          },
          ExpressionAttributeValues: {
            ':now': now.toISOString(),
            ':one': 1,
          },
        },
      },
    ],
  };
}
