import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type {
  DynamoDBRecord,
  DynamoDBStreamHandler,
} from 'aws-lambda';
import { env } from '$amplify/env/updateUserStats';
import {
  updateQueue as notifyQueue,
  updateUserStats as notifyUserStats,
} from './graphql/mutations';
import {
  buildQueueTransaction,
  buildStatsTransaction,
  isTransactionConflict,
  queueReceiptId,
  statsDeltaFromObservation,
  statsReceiptId,
  transactionConflictDelayMs,
  TRANSACTION_CONFLICT_ATTEMPTS,
  type StatsDelta,
} from './core';

const logger = new Logger({
  logLevel: 'INFO',
  serviceName: 'update-user-stats',
});

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

interface ModelTables {
  receipts: string;
  userStats: string;
  queues: string;
}

// The UserStats and Queue table names cannot be derived from the GraphQL
// endpoint (its hostname is an endpoint identifier, not the API ID Amplify
// uses in table suffixes), and they cannot be injected from backend.ts (the
// data stack references this function for its stream mapping, so a reference
// back would be a circular nested-stack dependency). The stream record's
// eventSourceARN carries the authoritative Observation-<apiId>-NONE table
// name, so the sibling model tables are derived from it.
function tablesFromEventSource(eventSourceARN: string | undefined): ModelTables {
  const tableName = eventSourceARN?.split('/')[1];
  const apiSuffix = tableName?.startsWith('Observation-')
    ? tableName.slice('Observation-'.length)
    : undefined;
  if (!apiSuffix) {
    throw new Error(
      `Cannot derive model tables from event source ${eventSourceARN}`
    );
  }
  return {
    receipts: requiredEnvironmentVariable('STATS_RECEIPT_TABLE'),
    userStats: `UserStats-${apiSuffix}`,
    queues: `Queue-${apiSuffix}`,
  };
}

const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: env.AWS_REGION, maxAttempts: 8 }),
  { marshallOptions: { removeUndefinedValues: true } }
);

Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT,
        region: env.AWS_REGION,
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          // No cached identity is used by this Lambda.
        },
      },
    },
  }
);

const graphQLClient = generateClient({ authMode: 'iam' });

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { organizationId }
  }
`;

interface GraphQLErrorLike {
  message?: string;
}

interface ProjectOrganizationResult {
  data?: {
    getProject?: { organizationId?: string | null } | null;
  };
  errors?: readonly GraphQLErrorLike[];
}

interface UserStatsNotificationResult {
  data?: { updateUserStats?: { projectId: string } | null };
  errors?: readonly GraphQLErrorLike[];
}

interface QueueNotificationResult {
  data?: { updateQueue?: { id: string } | null };
  errors?: readonly GraphQLErrorLike[];
}

const organizationIdCache = new Map<string, string>();

function describeGraphQLErrors(errors: readonly GraphQLErrorLike[] | undefined) {
  return errors?.map((error) => error.message ?? 'Unknown GraphQL error').join('; ');
}

interface GraphQLResultLike {
  data?: unknown;
  errors?: readonly GraphQLErrorLike[];
}

function isGraphQLResultLike(value: unknown): value is GraphQLResultLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('errors' in value || 'data' in value)
  );
}

// The Amplify client REJECTS with a plain { data, errors } object when the
// response carries GraphQL errors, so a thrown value and a returned value have
// the same shape and must be handled identically. Letting the rejection
// propagate skipped the queue-deleted fallback below and, because the thrown
// value is not an Error, logged only "[object Object]".
// The client's return type is a union that includes a subscription Observable,
// so the operation is typed loosely and awaited here.
async function runGraphQL<T>(operation: () => unknown): Promise<T> {
  try {
    return (await operation()) as T;
  } catch (error) {
    if (isGraphQLResultLike(error)) return error as T;
    throw error;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isGraphQLResultLike(error) && error.errors?.length) {
    return describeGraphQLErrors(error.errors) ?? 'Unknown GraphQL error';
  }
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

async function getOrganizationId(projectId: string): Promise<string> {
  const cached = organizationIdCache.get(projectId);
  if (cached !== undefined) return cached;

  const response = await runGraphQL<ProjectOrganizationResult>(() =>
    graphQLClient.graphql({
      query: getProjectOrganizationId,
      variables: { id: projectId },
    })
  );
  if (response.errors?.length) {
    throw new Error(
      `Failed to fetch organization for project ${projectId}: ${describeGraphQLErrors(response.errors)}`
    );
  }

  const organizationId = response.data?.getProject?.organizationId;
  if (!organizationId) {
    throw new Error(`Project ${projectId} has no organization`);
  }
  organizationIdCache.set(projectId, organizationId);
  return organizationId;
}

async function receiptExists(
  tables: ModelTables,
  receiptId: string
): Promise<boolean> {
  const response = await documentClient.send(
    new GetCommand({
      TableName: tables.receipts,
      Key: { id: receiptId },
      ConsistentRead: true,
      ProjectionExpression: 'id',
    })
  );
  return Boolean(response.Item);
}

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function transactOnce(
  tables: ModelTables,
  input: TransactWriteCommandInput,
  receiptId: string
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await documentClient.send(new TransactWriteCommand(input));
      return;
    } catch (error) {
      // A conflicted transaction is guaranteed not to have committed, so it
      // can be retried without consulting the receipt.
      if (
        isTransactionConflict(error) &&
        attempt < TRANSACTION_CONFLICT_ATTEMPTS - 1
      ) {
        await sleep(transactionConflictDelayMs(attempt));
        continue;
      }
      // This check covers both conditional duplicates and ambiguous network
      // failures where DynamoDB committed the transaction but the response was lost.
      if (await receiptExists(tables, receiptId)) return;
      throw error;
    }
  }
}

async function applyStats(
  tables: ModelTables,
  eventId: string,
  delta: StatsDelta
): Promise<void> {
  await transactOnce(
    tables,
    buildStatsTransaction(eventId, delta, {
      receipts: tables.receipts,
      userStats: tables.userStats,
    }),
    statsReceiptId(eventId)
  );
}

async function queueExists(
  tables: ModelTables,
  queueId: string
): Promise<boolean> {
  const response = await documentClient.send(
    new GetCommand({
      TableName: tables.queues,
      Key: { id: queueId },
      ConsistentRead: true,
      ProjectionExpression: 'id',
    })
  );
  return Boolean(response.Item);
}

async function applyQueueProgress(
  tables: ModelTables,
  eventId: string,
  delta: StatsDelta
): Promise<void> {
  if (!delta.queueId) return;

  const receiptId = queueReceiptId(eventId);
  try {
    await transactOnce(
      tables,
      buildQueueTransaction(
        eventId,
        delta.observationId,
        delta.queueId,
        { receipts: tables.receipts, queues: tables.queues }
      ),
      receiptId
    );
  } catch (error) {
    // A queue may legitimately be deleted after its work is completed. The
    // conditional update prevents accidentally recreating it.
    if (!(await queueExists(tables, delta.queueId))) {
      logger.info('Queue no longer exists; skipping progress update', {
        queueId: delta.queueId,
        observationId: delta.observationId,
      });
      return;
    }
    throw error;
  }
}

async function notifyStatsSubscribers(delta: StatsDelta): Promise<void> {
  // The counters are updated directly and atomically in DynamoDB. A key-only
  // AppSync update preserves the existing onUpdate subscription behavior
  // without reading or replacing any counter values.
  const response = await runGraphQL<UserStatsNotificationResult>(() =>
    graphQLClient.graphql({
      query: notifyUserStats,
      variables: {
        input: {
          projectId: delta.projectId,
          userId: delta.userId,
          date: delta.date,
          setId: delta.setId,
        },
      },
    })
  );

  if (response.errors?.length || !response.data?.updateUserStats) {
    throw new Error(
      `Failed to publish UserStats update: ${
        describeGraphQLErrors(response.errors) ?? 'no row returned'
      }`
    );
  }
}

async function notifyQueueSubscribers(
  tables: ModelTables,
  delta: StatsDelta
): Promise<void> {
  const queueId = delta.queueId;
  if (!queueId) return;

  const response = await runGraphQL<QueueNotificationResult>(() =>
    graphQLClient.graphql({
      query: notifyQueue,
      variables: { input: { id: queueId } },
    })
  );

  if (response.errors?.length || !response.data?.updateQueue) {
    // Queue deletion after completion is legitimate and should not poison the
    // Observation stream. Other failures must retry so subscribers stay fresh.
    if (!(await queueExists(tables, queueId))) {
      logger.info('Queue no longer exists; skipping subscriber notification', {
        queueId: delta.queueId,
        observationId: delta.observationId,
      });
      return;
    }
    throw new Error(
      `Failed to publish Queue update: ${
        describeGraphQLErrors(response.errors) ?? 'no row returned'
      }`
    );
  }
}

function observationFromRecord(record: DynamoDBRecord): Record<string, unknown> {
  const image = record.dynamodb?.NewImage;
  if (!image) throw new Error('INSERT stream record has no NewImage');
  return unmarshall(image as Parameters<typeof unmarshall>[0]);
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== 'INSERT') return;
  if (!record.eventID) throw new Error('Stream record has no eventID');

  const tables = tablesFromEventSource(record.eventSourceARN);
  const delta = statsDeltaFromObservation(observationFromRecord(record));
  if (!delta.organizationId) {
    delta.organizationId = await getOrganizationId(delta.projectId);
  }

  // These effects have separate receipts so a retry can resume between them.
  await applyStats(tables, record.eventID, delta);
  await applyQueueProgress(tables, record.eventID, delta);
  await notifyQueueSubscribers(tables, delta);
  await notifyStatsSubscribers(delta);
}

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error('Failed to aggregate Observation stream record', {
        eventId: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error: describeError(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // The event source mapping does not enable partial-batch responses.
      // Throw so Lambda retries the batch; transaction receipts make
      // already-applied records safe to replay, and the mapping's bisection,
      // retry bound, and SQS failure destination stop a permanently bad record
      // from stalling the shard.
      throw error;
    }
  }
};
