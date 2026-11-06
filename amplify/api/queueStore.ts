import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export interface QueueActivity {
  // Returns the new observed count.
  recordObservation(queueId: string): Promise<number>;
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
  async recordObservation(queueId) {
    const result = await dynamo.send(
      new UpdateCommand({
        TableName: queueTable(),
        Key: { id: queueId },
        UpdateExpression: 'ADD observedCount :inc SET lastObservationAt = :now',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: {
          ':inc': 1,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(result.Attributes?.observedCount ?? 0);
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
