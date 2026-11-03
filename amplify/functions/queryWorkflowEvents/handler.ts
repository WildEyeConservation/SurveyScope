import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { env } from '$amplify/env/queryWorkflowEvents';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import {
  assertSurveyAdmin,
  authorizeWorkflowStatsItem,
  requireWorkflowStatsUser,
} from '../workflowStats/readAuthorization';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AppSyncResolverHandler } from 'aws-lambda';
import { summariseEvents, type EventTotals } from './summarise';

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
        clearCredentialsAndIdentityId: () => {},
      },
    },
  }
);

const gqlClient = generateClient({ authMode: 'iam' });

async function executeGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = (await gqlClient.graphql({ query, variables } as never)) as GraphQLResult<T>;
  if (response.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`);
  }
  if (!response.data) throw new Error('GraphQL response missing data');
  return response.data;
}

const adminLookup = {
  organizationOf: async (projectId: string) =>
    (
      await executeGraphql<{ getProject?: { organizationId?: string | null } | null }>(
        `query GetProject($id: ID!) { getProject(id: $id) { organizationId } }`,
        { id: projectId }
      )
    ).getProject?.organizationId ?? null,
  isOrganizationAdmin: async (organizationId: string, userId: string) =>
    !!(
      await executeGraphql<{ getOrganizationMembership?: { isAdmin?: boolean | null } | null }>(
        `query GetOrganizationMembership($organizationId: ID!, $userId: String!) {
          getOrganizationMembership(organizationId: $organizationId, userId: $userId) { isAdmin }
        }`,
        { organizationId, userId }
      )
    ).getOrganizationMembership?.isAdmin,
  isProjectAdmin: async (projectId: string, userId: string) => {
    let nextToken: string | null | undefined;
    do {
      const data = await executeGraphql<{
        userProjectMembershipsByUserId?: {
          items: { projectId: string; isAdmin?: boolean | null }[];
          nextToken?: string | null;
        };
      }>(
        `query Memberships($userId: String!, $nextToken: String) {
          userProjectMembershipsByUserId(userId: $userId, limit: 1000, nextToken: $nextToken) {
            items { projectId isAdmin }
            nextToken
          }
        }`,
        { userId, nextToken }
      );
      const page = data.userProjectMembershipsByUserId;
      if (page?.items.some((m) => m.projectId === projectId && m.isAdmin)) return true;
      nextToken = page?.nextToken;
    } while (nextToken);
    return false;
  },
};

interface QueryWorkflowEventsArguments {
  projectId: string;
  runIds?: (string | null)[] | null;
  startAt?: string | null;
  endAt?: string | null;
  nextToken?: string | null;
  limit?: number | null;
  /** Per-user totals instead of task events; open to all organization members. */
  summary?: boolean | null;
}

interface WorkflowEvent {
  eventId: string;
  workflowType: string;
  workflowRunId: string;
  annotationSetId: string;
  userId: string;
  workItemType: string;
  workItemId: string;
  startedAt?: string;
  completedAt: string;
  activeTimeMs: number;
  waitingTimeMs: number;
  outcome: string;
  skipped: boolean;
  metrics: Record<string, number>;
}

type QueryWorkflowEventsResult =
  | { events: WorkflowEvent[]; nextToken: string | null }
  | { totals: EventTotals[]; count: number; nextToken: string | null };

// The page cursor names the run being read and DynamoDB's own continuation
// key inside it, so a multi-run export resumes exactly where it stopped.
interface PageCursor {
  runIndex: number;
  lastKey?: Record<string, unknown>;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const tables = {
  runs: requiredEnvironmentVariable('WORKFLOW_RUNS_TABLE'),
  events: requiredEnvironmentVariable('WORKFLOW_EVENTS_TABLE'),
};

const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 5 })
);

// One page must stay well inside the AppSync response limit. An event is a
// few hundred bytes once serialized, so this keeps a page under about 1 MB.
const DEFAULT_PAGE_SIZE = 1_500;
const MAX_PAGE_SIZE = 2_000;
// Summaries return totals only, so a page can read far more events.
const SUMMARY_PAGE_SIZE = 20_000;
const MAX_RUNS = 50;

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`${field} must be an ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function decodeCursor(value: unknown): PageCursor {
  if (value === undefined || value === null || value === '') {
    return { runIndex: 0 };
  }
  if (typeof value !== 'string') throw new Error('nextToken is invalid');
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    ) as PageCursor;
    if (!Number.isInteger(parsed.runIndex) || parsed.runIndex < 0) {
      throw new Error('bad runIndex');
    }
    return parsed;
  } catch {
    throw new Error('nextToken is invalid');
  }
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function eventFromItem(item: Record<string, unknown>): WorkflowEvent {
  const rawMetrics =
    item.metrics && typeof item.metrics === 'object'
      ? (item.metrics as Record<string, unknown>)
      : {};
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawMetrics)) {
    metrics[key] = number(value);
  }
  return {
    eventId: String(item.eventId ?? ''),
    workflowType: String(item.workflowType ?? ''),
    workflowRunId: String(item.workflowRunId ?? ''),
    annotationSetId: String(item.annotationSetId ?? ''),
    userId: String(item.userId ?? ''),
    workItemType: String(item.workItemType ?? ''),
    workItemId: String(item.workItemId ?? ''),
    startedAt: typeof item.startedAt === 'string' ? item.startedAt : undefined,
    completedAt: String(item.completedAt ?? ''),
    activeTimeMs: number(item.activeTimeMs),
    waitingTimeMs: number(item.waitingTimeMs),
    outcome: String(item.outcome ?? ''),
    skipped: item.skipped === true,
    metrics,
  };
}

// Every requested run must belong to the named project. Sysadmins can read
// any project, but a run list is still validated so a mistaken ID cannot mix
// another survey's work into an export.
async function assertRunsBelongToProject(
  runIds: string[],
  projectId: string,
  identity: unknown
): Promise<void> {
  const found = new Set<string>();
  for (let start = 0; start < runIds.length; start += 100) {
    const keys = runIds.slice(start, start + 100).map((runId) => ({ runId }));
    let request: Record<string, { Keys: Record<string, unknown>[] }> | undefined = {
      [tables.runs]: { Keys: keys },
    };
    while (request && Object.keys(request).length > 0) {
      const response = await documentClient.send(
        new BatchGetCommand({
          RequestItems: Object.fromEntries(
            Object.entries(request).map(([table, value]) => [
              table,
              { ...value, ProjectionExpression: 'runId, projectId, organizationId' },
            ])
          ),
        })
      );
      for (const item of response.Responses?.[tables.runs] ?? []) {
        authorizeWorkflowStatsItem(identity, item);
        if (item.projectId === projectId) found.add(String(item.runId));
      }
      request = response.UnprocessedKeys as typeof request;
    }
  }
  const missing = runIds.filter((runId) => !found.has(runId));
  if (missing.length > 0) {
    throw new Error(
      `Runs do not belong to project ${projectId}: ${missing.join(', ')}`
    );
  }
}

export const handler: AppSyncResolverHandler<
  QueryWorkflowEventsArguments,
  QueryWorkflowEventsResult
> = async (event) => {
  requireWorkflowStatsUser(event.identity);
  const projectId = assertIdentifier(event.arguments.projectId, 'projectId');
  const summary = event.arguments.summary === true;
  if (!summary) await assertSurveyAdmin(event.identity, projectId, adminLookup);
  const startAt = optionalTimestamp(event.arguments.startAt, 'startAt');
  const endAt = optionalTimestamp(event.arguments.endAt, 'endAt');
  if (startAt && endAt && startAt > endAt) {
    throw new Error('startAt cannot be after endAt');
  }
  const requestedLimit = event.arguments.limit;
  const pageSize = summary
    ? SUMMARY_PAGE_SIZE
    : typeof requestedLimit === 'number' && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const runIds = [
    ...new Set(
      (event.arguments.runIds ?? []).filter(
        (id): id is string => typeof id === 'string' && id.trim() !== ''
      )
    ),
  ];
  if (runIds.length === 0) {
    return summary ? { totals: [], count: 0, nextToken: null } : { events: [], nextToken: null };
  }
  if (runIds.length > MAX_RUNS) {
    throw new Error(`At most ${MAX_RUNS} runs can be queried at once`);
  }
  await assertRunsBelongToProject(runIds, projectId, event.identity);

  const cursor = decodeCursor(event.arguments.nextToken);
  if (cursor.runIndex >= runIds.length) {
    return summary ? { totals: [], count: 0, nextToken: null } : { events: [], nextToken: null };
  }

  const events: WorkflowEvent[] = [];
  let runIndex = cursor.runIndex;
  let lastKey = cursor.lastKey;

  while (runIndex < runIds.length && events.length < pageSize) {
    const conditions = ['#workflowRunId = :runId'];
    const values: Record<string, string> = { ':runId': runIds[runIndex] };
    if (startAt && endAt) {
      conditions.push('#completedAt BETWEEN :from AND :to');
      values[':from'] = startAt;
      values[':to'] = endAt;
    } else if (startAt) {
      conditions.push('#completedAt >= :from');
      values[':from'] = startAt;
    } else if (endAt) {
      conditions.push('#completedAt <= :to');
      values[':to'] = endAt;
    }

    const response = await documentClient.send(
      new QueryCommand({
        TableName: tables.events,
        IndexName: 'byRunAndCompletedAt',
        KeyConditionExpression: conditions.join(' AND '),
        ExpressionAttributeNames: {
          '#workflowRunId': 'workflowRunId',
          '#completedAt': 'completedAt',
        },
        ExpressionAttributeValues: values,
        Limit: pageSize - events.length,
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of response.Items ?? []) {
      authorizeWorkflowStatsItem(event.identity, item);
      events.push(eventFromItem(item as Record<string, unknown>));
    }

    if (response.LastEvaluatedKey) {
      lastKey = response.LastEvaluatedKey;
    } else {
      runIndex += 1;
      lastKey = undefined;
    }
  }

  const nextToken =
    runIndex < runIds.length ? encodeCursor({ runIndex, lastKey }) : null;
  if (summary) return { totals: summariseEvents(events), count: events.length, nextToken };
  return { events, nextToken };
};
