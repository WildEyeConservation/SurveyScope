import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { RecordWorkflowTaskHandler } from '../../data/resource';
import {
  authorizeWorkflowTask,
  workflowTaskKey,
  type WorkflowTaskLookups,
} from './authorize';
import {
  parseRecordWorkflowTaskEventInput,
  prepareWorkflowTaskEvent,
  type WorkflowStatsTables,
} from '../workflowStats/core';
import { writeWorkflowTaskEvent } from '../workflowStats/store';

// The run supplies workflow, survey and organisation; the caller must be in
// that survey, the work item must belong to the run, and the dedupe key is
// derived here rather than taken from the client.

const logger = new Logger({
  serviceName: 'record-workflow-task',
  logLevel: 'INFO',
});

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const tables: WorkflowStatsTables = {
  runs: requiredEnvironmentVariable('WORKFLOW_RUNS_TABLE'),
  events: requiredEnvironmentVariable('WORKFLOW_EVENTS_TABLE'),
  dailyStats: requiredEnvironmentVariable('WORKFLOW_DAILY_STATS_TABLE'),
};

const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 5 }),
  { marshallOptions: { removeUndefinedValues: true } }
);

Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: requiredEnvironmentVariable('AMPLIFY_DATA_GRAPHQL_ENDPOINT'),
        region: requiredEnvironmentVariable('AWS_REGION'),
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: requiredEnvironmentVariable('AWS_ACCESS_KEY_ID'),
            secretAccessKey: requiredEnvironmentVariable('AWS_SECRET_ACCESS_KEY'),
            sessionToken: process.env.AWS_SESSION_TOKEN,
          },
        }),
        clearCredentialsAndIdentityId: () => {},
      },
    },
  }
);

const gqlClient = generateClient({ authMode: 'iam' });

async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = (await gqlClient.graphql({
    query,
    variables,
  } as never)) as GraphQLResult<T>;
  if (response.errors?.length) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
    );
  }
  if (!response.data) throw new Error('GraphQL response missing data');
  return response.data;
}

const lookups: WorkflowTaskLookups = {
  isSurveyMember: async (projectId, userId) => {
    let nextToken: string | null | undefined;
    do {
      const data = await executeGraphql<{
        userProjectMembershipsByUserId?: {
          items: { projectId: string }[];
          nextToken?: string | null;
        };
      }>(
        `query Memberships($userId: String!, $nextToken: String) {
          userProjectMembershipsByUserId(userId: $userId, limit: 1000, nextToken: $nextToken) {
            items { projectId }
            nextToken
          }
        }`,
        { userId, nextToken }
      );
      const page = data.userProjectMembershipsByUserId;
      if (page?.items.some((m) => m.projectId === projectId)) return true;
      nextToken = page?.nextToken;
    } while (nextToken);
    return false;
  },
  isOrganizationAdmin: async (organizationId, userId) =>
    !!(
      await executeGraphql<{
        getOrganizationMembership?: { isAdmin?: boolean | null } | null;
      }>(
        `query GetOrganizationMembership($organizationId: ID!, $userId: String!) {
          getOrganizationMembership(organizationId: $organizationId, userId: $userId) { isAdmin }
        }`,
        { organizationId, userId }
      )
    ).getOrganizationMembership?.isAdmin,
  annotation: async (id) =>
    (
      await executeGraphql<{
        getAnnotation?: { projectId?: string | null; setId?: string | null } | null;
      }>(`query GetAnnotation($id: ID!) { getAnnotation(id: $id) { projectId setId } }`, {
        id,
      })
    ).getAnnotation ?? null,
  imageProject: async (id) =>
    (
      await executeGraphql<{ getImage?: { projectId?: string | null } | null }>(
        `query GetImage($id: ID!) { getImage(id: $id) { projectId } }`,
        { id }
      )
    ).getImage?.projectId ?? null,
};

function parsedMetrics(raw: unknown): Record<string, number> {
  if (raw === undefined || raw === null || raw === '') return {};
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('metrics must be a JSON object');
  }
  // Values are validated against the workflow's whitelist by the shared
  // contract; this only rejects shapes it could not check.
  return value as Record<string, number>;
}

export const handler: RecordWorkflowTaskHandler = async (event) => {
  const userId = event.identity?.sub;
  if (!userId) {
    throw new Error('Unauthorized: a user identity is required');
  }

  const runResponse = await documentClient.send(
    new GetCommand({
      TableName: tables.runs,
      Key: { runId: event.arguments.workflowRunId },
      ConsistentRead: true,
      ProjectionExpression:
        'runId, workflowType, projectId, annotationSetId, organizationId',
    })
  );
  const run = runResponse.Item;
  if (!run) {
    throw new Error(`Unknown workflow run ${event.arguments.workflowRunId}`);
  }
  const organizationId = run.organizationId;
  if (typeof organizationId !== 'string' || organizationId === '') {
    throw new Error('Workflow run has no organization');
  }
  const groups = Array.isArray(event.identity?.groups)
    ? event.identity.groups.filter((g): g is string => typeof g === 'string')
    : [];
  await authorizeWorkflowTask(
    { sub: userId, groups },
    {
      runId: String(run.runId),
      workflowType: String(run.workflowType),
      projectId: String(run.projectId),
      annotationSetId: String(run.annotationSetId),
      organizationId,
    },
    event.arguments.workItemType,
    event.arguments.workItemId,
    lookups
  );

  const actor = { userId, organizationId };
  const task = parseRecordWorkflowTaskEventInput({
    idempotencyKey: workflowTaskKey(
      event.arguments.workItemType,
      event.arguments.workItemId,
      userId
    ),
    workflowType: run.workflowType,
    workflowRunId: run.runId,
    projectId: run.projectId,
    annotationSetId: run.annotationSetId,
    workItemType: event.arguments.workItemType,
    workItemId: event.arguments.workItemId,
    startedAt: event.arguments.startedAt ?? undefined,
    activeTimeMs: event.arguments.activeTimeMs ?? 0,
    waitingTimeMs: event.arguments.waitingTimeMs ?? 0,
    outcome: event.arguments.outcome,
    skipped: event.arguments.skipped ?? false,
    metrics: parsedMetrics(event.arguments.metrics),
  });
  const prepared = prepareWorkflowTaskEvent(task, actor);

  try {
    const result = await writeWorkflowTaskEvent(
      documentClient,
      tables,
      task,
      actor,
      prepared
    );
    return { eventId: result.eventId, duplicate: result.duplicate };
  } catch (error) {
    // A work item legitimately revisited after it was first recorded produces
    // the same event id with a different payload. The unit is deliberately
    // counted once, so this is reported as a duplicate rather than failing the
    // caller, whose real work is already saved elsewhere.
    const existing = await documentClient.send(
      new GetCommand({
        TableName: tables.events,
        Key: { eventId: prepared.eventId },
        ConsistentRead: true,
        ProjectionExpression: 'eventId',
      })
    );
    if (existing.Item) {
      logger.info('Work item already recorded with different totals', {
        eventId: prepared.eventId,
        workflowRunId: task.workflowRunId,
        workItemId: task.workItemId,
      });
      return { eventId: prepared.eventId, duplicate: true };
    }
    logger.error('Failed to record workflow task', {
      workflowRunId: task.workflowRunId,
      workItemId: task.workItemId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
