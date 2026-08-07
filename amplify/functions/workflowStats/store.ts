import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  buildRecordWorkflowTaskEventTransaction,
  type PreparedWorkflowTaskEvent,
  type RecordWorkflowTaskEventInput,
  type WorkflowActor,
  type WorkflowStatsTables,
} from './core';

export interface WorkflowTaskEventWriteResult {
  eventId: string;
  duplicate: boolean;
}

export async function writeWorkflowTaskEvent(
  documentClient: DynamoDBDocumentClient,
  tables: WorkflowStatsTables,
  task: RecordWorkflowTaskEventInput,
  actor: WorkflowActor,
  prepared: PreparedWorkflowTaskEvent
): Promise<WorkflowTaskEventWriteResult> {
  try {
    await documentClient.send(
      new TransactWriteCommand(
        buildRecordWorkflowTaskEventTransaction(task, actor, prepared, tables)
      )
    );
    return { eventId: prepared.eventId, duplicate: false };
  } catch (error) {
    try {
      // A matching immutable event proves that a duplicate invocation, or an
      // ambiguous network timeout after commit, has already been applied.
      const existing = await documentClient.send(
        new GetCommand({
          TableName: tables.events,
          Key: { eventId: prepared.eventId },
          ConsistentRead: true,
          ProjectionExpression: 'eventId, inputDigest',
        })
      );
      if (existing.Item?.inputDigest === prepared.inputDigest) {
        return { eventId: prepared.eventId, duplicate: true };
      }
    } catch {
      // Preserve the original transaction error if the diagnostic read also
      // fails; it is the operation Lambda must retry.
    }
    throw error;
  }
}
