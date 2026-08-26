import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { AppSyncResolverHandler } from 'aws-lambda';
import {
  WORKFLOW_TYPES,
  type WorkflowType,
} from '../../../shared/workflowStats';

interface QueryWorkflowStatsArguments {
  projectId: string;
  annotationSetIds?: (string | null)[] | null;
  startDate?: string | null;
  endDate?: string | null;
}

interface WorkflowStatsBucket {
  workflowType: WorkflowType;
  annotationSetId: string;
  date: string;
  userId: string;
  workflowRunId: string;
  completedUnits: number;
  skippedUnits: number;
  activeTimeMs: number;
  waitingTimeMs: number;
  metrics: Record<string, number>;
}

interface WorkflowRunSummary {
  runId: string;
  workflowType: string;
  annotationSetId: string;
  displayName: string;
  status: string;
  launchedAt: string;
  finishedAt: string | null;
  finishReason: string | null;
}

interface QueryWorkflowStatsResult {
  buckets: WorkflowStatsBucket[];
  runs: WorkflowRunSummary[];
  truncated: boolean;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const tables = {
  runs: requiredEnvironmentVariable('WORKFLOW_RUNS_TABLE'),
  dailyStats: requiredEnvironmentVariable('WORKFLOW_DAILY_STATS_TABLE'),
};

const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 5 })
);

// A guard against an unbounded read: a project with a very long history should
// return a truncated answer the screen can report rather than time out.
const MAX_BUCKETS = 20_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 512) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new Error(`${field} must be formatted YYYY-MM-DD`);
  }
  return value;
}

async function queryAll(
  input: QueryCommandInput,
  remaining: number
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const response = await documentClient.send(
      new QueryCommand({ ...input, ExclusiveStartKey: exclusiveStartKey })
    );
    items.push(...((response.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = response.LastEvaluatedKey;
    if (items.length >= remaining) return items.slice(0, remaining);
  } while (exclusiveStartKey);
  return items;
}

const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function bucketFromItem(
  item: Record<string, unknown>,
  workflowType: WorkflowType,
  annotationSetId: string
): WorkflowStatsBucket {
  // metric_* columns are accumulated per workflow, so they are collected
  // generically rather than being enumerated here. The registry decides which
  // ones a workflow can have; the screen decides how to label them.
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(item)) {
    if (key.startsWith('metric_')) {
      metrics[key.slice('metric_'.length)] = number(value);
    }
  }
  return {
    workflowType,
    annotationSetId,
    date: typeof item.date === 'string' ? item.date : '',
    userId: typeof item.userId === 'string' ? item.userId : '',
    workflowRunId:
      typeof item.workflowRunId === 'string' ? item.workflowRunId : '',
    completedUnits: number(item.completedUnits),
    skippedUnits: number(item.skippedUnits),
    activeTimeMs: number(item.activeTimeMs),
    waitingTimeMs: number(item.waitingTimeMs),
    metrics,
  };
}

export const handler: AppSyncResolverHandler<
  QueryWorkflowStatsArguments,
  QueryWorkflowStatsResult
> = async (event) => {
  const projectId = assertIdentifier(event.arguments.projectId, 'projectId');
  const startDate = optionalDate(event.arguments.startDate, 'startDate');
  const endDate = optionalDate(event.arguments.endDate, 'endDate');
  if (startDate && endDate && startDate > endDate) {
    throw new Error('startDate cannot be after endDate');
  }
  const annotationSetIds = [
    ...new Set(
      (event.arguments.annotationSetIds ?? [])
        .filter((id): id is string => typeof id === 'string' && id.trim() !== '')
    ),
  ];
  if (annotationSetIds.length === 0) {
    return { buckets: [], runs: [], truncated: false };
  }
  if (annotationSetIds.length > 50) {
    throw new Error('At most 50 annotation sets can be queried at once');
  }

  const buckets: WorkflowStatsBucket[] = [];
  let truncated = false;

  // One Query per (annotation set, workflow) scope. Each is a direct partition
  // read, and the date prefix of the sort key bounds it further when a start
  // date is given.
  for (const annotationSetId of annotationSetIds) {
    for (const workflowType of WORKFLOW_TYPES) {
      if (buckets.length >= MAX_BUCKETS) {
        truncated = true;
        break;
      }
      const keyCondition = startDate
        ? '#scopeKey = :scopeKey AND #bucketKey >= :from'
        : '#scopeKey = :scopeKey';
      const items = await queryAll(
        {
          TableName: tables.dailyStats,
          KeyConditionExpression: keyCondition,
          ExpressionAttributeNames: {
            '#scopeKey': 'scopeKey',
            ...(startDate ? { '#bucketKey': 'bucketKey' } : {}),
          },
          ExpressionAttributeValues: {
            ':scopeKey': `PROJECT#${projectId}#SET#${annotationSetId}#WORKFLOW#${workflowType}`,
            ...(startDate ? { ':from': `DATE#${startDate}` } : {}),
          },
        },
        MAX_BUCKETS - buckets.length
      );
      for (const item of items) {
        const bucket = bucketFromItem(item, workflowType, annotationSetId);
        // The sort key starts with the date, so the upper bound is applied here
        // rather than as a second key condition.
        if (endDate && bucket.date > endDate) continue;
        if (startDate && bucket.date < startDate) continue;
        buckets.push(bucket);
      }
    }
  }

  // Run metadata gives the screen human-readable names and lets it show runs
  // that exist but have no completions yet.
  const runItems = await queryAll(
    {
      TableName: tables.runs,
      IndexName: 'byProjectAndLaunchedAt',
      KeyConditionExpression: '#projectId = :projectId',
      ExpressionAttributeNames: { '#projectId': 'projectId' },
      ExpressionAttributeValues: { ':projectId': projectId },
      ScanIndexForward: false,
    },
    2_000
  );
  const wantedSets = new Set(annotationSetIds);
  const runs: WorkflowRunSummary[] = runItems
    .filter(
      (item) =>
        typeof item.annotationSetId === 'string' &&
        wantedSets.has(item.annotationSetId)
    )
    .map((item) => ({
      runId: String(item.runId ?? ''),
      workflowType: String(item.workflowType ?? ''),
      annotationSetId: String(item.annotationSetId ?? ''),
      displayName: String(item.displayName ?? ''),
      status: String(item.status ?? ''),
      launchedAt: String(item.launchedAt ?? ''),
      finishedAt:
        typeof item.finishedAt === 'string' ? item.finishedAt : null,
      finishReason:
        typeof item.finishReason === 'string' ? item.finishReason : null,
    }));

  return { buckets, runs, truncated };
};
