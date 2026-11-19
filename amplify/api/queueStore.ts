import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

export interface QueueActivity {
  // Adds a task's work to its queue's count and marks the task counted, together.
  // False when the task was already counted.
  recordTaskObservation(
    queueId: string,
    lease: { userId: string; leaseId: string },
  ): Promise<boolean>;
  // False when the queue was touched within the hour and needs no write.
  touch(queueId: string): Promise<boolean>;
}

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const HOUR_MS = 60 * 60 * 1000;

const queueTable = () => {
  const name = (
    JSON.parse(process.env.API_TABLES ?? '{}') as Record<string, string>
  ).Queue;
  if (!name) throw new Error('No Queue table in API_TABLES');
  return name;
};

const conditionFailed = (error: unknown) =>
  (error as { name?: string }).name === 'ConditionalCheckFailedException';

export const dynamoQueueActivity: QueueActivity = {
  async recordTaskObservation(queueId, lease) {
    const leaseTable = process.env.TASK_LEASES_TABLE;
    if (!leaseTable) throw new Error('TASK_LEASES_TABLE is not set');
    try {
      await dynamo.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: leaseTable,
                Key: { userId: lease.userId, leaseId: lease.leaseId },
                UpdateExpression: 'SET counted = :yes',
                ConditionExpression:
                  'attribute_exists(leaseId) AND attribute_not_exists(counted)',
                ExpressionAttributeValues: { ':yes': true },
              },
            },
            {
              Update: {
                TableName: queueTable(),
                Key: { id: queueId },
                UpdateExpression:
                  'ADD observedCount :inc SET lastObservationAt = :now',
                ConditionExpression: 'attribute_exists(id)',
                ExpressionAttributeValues: {
                  ':inc': 1,
                  ':now': new Date().toISOString(),
                },
              },
            },
          ],
        }),
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'TransactionCanceledException')
        return false;
      throw error;
    }
  },

  async touch(queueId) {
    const now = Date.now();
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: queueTable(),
          Key: { id: queueId },
          UpdateExpression:
            'SET lastAccessedAt = :now REMOVE inactivityWarnedAt, cancelAfter',
          ConditionExpression:
            'attribute_exists(id) AND (attribute_not_exists(lastAccessedAt) OR lastAccessedAt < :since OR attribute_exists(cancelAfter))',
          ExpressionAttributeValues: {
            ':now': new Date(now).toISOString(),
            ':since': new Date(now - HOUR_MS).toISOString(),
          },
        }),
      );
      return true;
    } catch (error) {
      if (conditionFailed(error)) return false;
      throw error;
    }
  },
};
