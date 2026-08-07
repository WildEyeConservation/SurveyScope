import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import type { Handler } from 'aws-lambda';
import {
  parseRecordWorkflowTaskEventInput,
  parseWorkflowActor,
  prepareWorkflowTaskEvent,
  type RecordWorkflowTaskEventInput,
  type WorkflowActor,
  type WorkflowStatsTables,
} from './core';
import { writeWorkflowTaskEvent } from './store';

interface TrustedRecordWorkflowTaskEventRequest {
  actor: WorkflowActor;
  task: RecordWorkflowTaskEventInput;
  completedAt?: string;
}

interface RecordWorkflowTaskEventResult {
  eventId: string;
  duplicate: boolean;
}

const logger = new Logger({
  serviceName: 'record-workflow-task-event',
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
  new DynamoDBClient({
    region: process.env.AWS_REGION,
    maxAttempts: 8,
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export const handler: Handler<
  TrustedRecordWorkflowTaskEventRequest,
  RecordWorkflowTaskEventResult
> = async (request) => {
  const actor = parseWorkflowActor(request?.actor);
  const task = parseRecordWorkflowTaskEventInput(request?.task);
  const prepared = prepareWorkflowTaskEvent(task, actor, {
    completedAt: request.completedAt,
  });

  try {
    return await writeWorkflowTaskEvent(
      documentClient,
      tables,
      task,
      actor,
      prepared
    );
  } catch (error) {
    logger.error('Failed to record workflow task event', {
      eventId: prepared.eventId,
      workflowType: task.workflowType,
      workflowRunId: task.workflowRunId,
      projectId: task.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
