import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
  Handler,
} from 'aws-lambda';
import {
  parseRecordWorkflowTaskEventInput,
  prepareWorkflowTaskEvent,
  type WorkflowStatsTables,
} from './core';
import {
  workflowTaskFromObservation,
  type WorkflowRunIdentity,
} from './observationAdapter';
import { writeWorkflowTaskEvent } from './store';

const logger = new Logger({
  serviceName: 'project-observation-workflow-stats',
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
const runCache = new Map<string, WorkflowRunIdentity>();

function observationFromRecord(record: DynamoDBRecord): Record<string, unknown> {
  const image = record.dynamodb?.NewImage;
  if (!image) throw new Error('INSERT stream record has no NewImage');
  return unmarshall(image as Parameters<typeof unmarshall>[0]);
}

function runIdentity(item: Record<string, unknown>): WorkflowRunIdentity {
  const required = (field: string): string => {
    const value = item[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Workflow Run is missing ${field}`);
    }
    return value;
  };
  const workflowType = required('workflowType');
  if (
    workflowType !== 'species-labelling' &&
    workflowType !== 'false-negatives'
  ) {
    throw new Error(`Unsupported Observation workflow ${workflowType}`);
  }
  return {
    runId: required('runId'),
    workflowType,
    projectId: required('projectId'),
    annotationSetId: required('annotationSetId'),
    organizationId: required('organizationId'),
  };
}

async function findRun(runId: string): Promise<WorkflowRunIdentity | null> {
  const cached = runCache.get(runId);
  if (cached) return cached;

  const response = await documentClient.send(
    new GetCommand({
      TableName: tables.runs,
      Key: { runId },
      ConsistentRead: true,
      ProjectionExpression:
        'runId, workflowType, projectId, annotationSetId, organizationId',
    })
  );
  if (!response.Item) return null;

  const run = runIdentity(response.Item);
  if (runCache.size >= 500) runCache.clear();
  runCache.set(runId, run);
  return run;
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== 'INSERT') return;
  const observation = observationFromRecord(record);
  const queueId = observation.queueId;
  if (typeof queueId !== 'string' || queueId.trim() === '') {
    logger.debug('Observation has no queue; skipping shadow projection', {
      observationId: observation.id,
    });
    return;
  }

  const run = await findRun(queueId);
  if (!run) {
    // TRIM_HORIZON can surface Observations from before shadow-mode run
    // creation existed. Skipping them keeps migration history explicit and
    // prevents legacy records from blocking a live stream shard.
    logger.warn('No Workflow Run for Observation; skipping legacy record', {
      observationId: observation.id,
      queueId,
    });
    return;
  }

  const decision = workflowTaskFromObservation(observation, run);
  if (decision.kind === 'skip') {
    logger.info('Observation excluded from workflow statistics', {
      observationId: observation.id,
      queueId,
      reason: decision.reason,
    });
    return;
  }

  const task = parseRecordWorkflowTaskEventInput(decision.task);
  const prepared = prepareWorkflowTaskEvent(task, decision.actor, {
    completedAt: decision.completedAt,
  });
  await writeWorkflowTaskEvent(
    documentClient,
    tables,
    task,
    decision.actor,
    prepared
  );
}

export const handler: Handler<
  DynamoDBStreamEvent,
  DynamoDBBatchResponse
> = async (
  event
): Promise<DynamoDBBatchResponse> => {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      const sequenceNumber = record.dynamodb?.SequenceNumber;
      logger.error('Failed to project Observation into workflow statistics', {
        eventId: record.eventID,
        sequenceNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!sequenceNumber) throw error;
      // DynamoDB Streams checkpoints at the lowest failed sequence number, so
      // later records in this batch will be retried without listing each one.
      return {
        batchItemFailures: [{ itemIdentifier: sequenceNumber }],
      };
    }
  }
  return { batchItemFailures: [] };
};
