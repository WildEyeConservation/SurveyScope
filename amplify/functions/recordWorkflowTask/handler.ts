import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import type { RecordWorkflowTaskHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  parseRecordWorkflowTaskEventInput,
  prepareWorkflowTaskEvent,
  type WorkflowStatsTables,
} from '../workflowStats/core';
import { writeWorkflowTaskEvent } from '../workflowStats/store';

/**
 * Records one completed unit of work for a browser-driven workflow.
 *
 * The caller names the run and the work item only. Workflow type, project,
 * annotation set and organization are read from the durable Workflow Run, and
 * the credited user comes from the request identity, so a client cannot
 * attribute work to another user, project or organization.
 */

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
  // The organization comes from the run, so this checks the caller against the
  // owning organization rather than one the caller supplied.
  authorizeRequest(event.identity, organizationId);

  const actor = { userId, organizationId };
  const task = parseRecordWorkflowTaskEventInput({
    idempotencyKey:
      event.arguments.idempotencyKey ??
      `${event.arguments.workItemType}:${event.arguments.workItemId}`,
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
