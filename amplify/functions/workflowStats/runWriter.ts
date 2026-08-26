import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  buildCreateWorkflowRunPut,
  buildFinishWorkflowRunUpdate,
  type CreateWorkflowRunInput,
  type FinishWorkflowRunInput,
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

/**
 * Closes a run when the work that backs it ends. Returns 'skipped' when the
 * run is unknown (launched before runs existed) or already finished. Like run
 * creation this is best-effort: a statistics outage must not stop a queue
 * from being cleaned up or a job from being cancelled.
 */
export async function finishShadowWorkflowRun(
  input: FinishWorkflowRunInput
): Promise<'finished' | 'skipped' | 'failed'> {
  const tableName = process.env.WORKFLOW_RUNS_TABLE;
  if (!tableName) {
    console.error('Workflow statistics run finish skipped', {
      runId: input.runId,
      error: 'WORKFLOW_RUNS_TABLE is not configured',
    });
    return 'failed';
  }
  try {
    await documentClient.send(
      new UpdateCommand(buildFinishWorkflowRunUpdate(input, tableName))
    );
    console.info('Workflow statistics run finished', {
      runId: input.runId,
      status: input.status,
      reason: input.reason,
    });
    return 'finished';
  } catch (error) {
    if ((error as { name?: string })?.name === 'ConditionalCheckFailedException') {
      console.info('Workflow statistics run not active; finish skipped', {
        runId: input.runId,
      });
      return 'skipped';
    }
    console.error('Workflow statistics run finish failed', {
      runId: input.runId,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
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
