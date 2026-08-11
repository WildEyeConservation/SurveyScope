import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  buildCreateWorkflowRunPut,
  type CreateWorkflowRunInput,
  type WorkflowActor,
} from './core';

const documentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION,
    maxAttempts: 8,
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export function workflowLaunchUserId(identity: unknown): string {
  if (identity && typeof identity === 'object' && 'sub' in identity) {
    const sub = (identity as { sub?: unknown }).sub;
    if (typeof sub === 'string' && sub.trim() !== '') return sub;
  }
  return 'system';
}

async function ensureWorkflowRun(
  input: CreateWorkflowRunInput,
  actor: WorkflowActor
): Promise<'created' | 'existing'> {
  const tableName = process.env.WORKFLOW_RUNS_TABLE;
  if (!tableName) throw new Error('WORKFLOW_RUNS_TABLE is not configured');

  try {
    await documentClient.send(
      new PutCommand(buildCreateWorkflowRunPut(input, actor, tableName))
    );
    return 'created';
  } catch (error) {
    try {
      const existing = await documentClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { runId: input.runId },
          ConsistentRead: true,
          ProjectionExpression:
            'runId, workflowType, projectId, annotationSetId, organizationId',
        })
      );
      if (
        existing.Item?.workflowType === input.workflowType &&
        existing.Item?.projectId === input.projectId &&
        existing.Item?.annotationSetId === input.annotationSetId &&
        existing.Item?.organizationId === actor.organizationId
      ) {
        return 'existing';
      }
    } catch {
      // Preserve the original conditional or service error below.
    }
    throw error;
  }
}

export async function createShadowWorkflowRun(
  input: CreateWorkflowRunInput,
  actor: WorkflowActor
): Promise<boolean> {
  try {
    const result = await ensureWorkflowRun(input, actor);
    console.info('Workflow statistics run ready', {
      runId: input.runId,
      workflowType: input.workflowType,
      result,
    });
    return true;
  } catch (error) {
    // This is a shadow pipeline. A statistics outage must not prevent the real
    // workflow from launching; the raw Observation remains available for
    // reconciliation or controlled replay.
    console.error('Workflow statistics run creation failed', {
      runId: input.runId,
      workflowType: input.workflowType,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
