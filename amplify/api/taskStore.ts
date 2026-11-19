import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandOutput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Lease } from './leases';
import type { Row } from './schema';

export interface QueueMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  receiveCount: number;
}

export interface TaskQueue {
  receive(
    url: string,
    visibility: number,
    max: number,
  ): Promise<QueueMessage[]>;
  remove(url: string, receiptHandle: string): Promise<void>;
  visibility(
    url: string,
    receiptHandle: string,
    seconds: number,
  ): Promise<void>;
  depth(url: string): Promise<string>;
}

export interface LeaseTable {
  put(lease: Lease): Promise<void>;
  get(userId: string, leaseId: string): Promise<Lease | null>;
  active(userId: string): Promise<Lease[]>;
  // False when the lease is gone or already finished.
  transition(
    userId: string,
    leaseId: string,
    change: LeaseChange,
  ): Promise<boolean>;
  // A short exclusive hold, so a check and the writes it allows cannot interleave.
  lock(userId: string, name: string, seconds: number): Promise<boolean>;
  fixGrade(
    userId: string,
    leaseId: string,
    grade: NonNullable<NonNullable<Lease['test']>['grade']>,
  ): Promise<void>;
  unlock(userId: string, name: string): Promise<void>;
  // Small per-user records kept beside the leases, such as test cadence.
  getState(userId: string, name: string): Promise<Row | null>;
  putState(userId: string, name: string, value: Row): Promise<void>;
}

// Release and acknowledgement are final; only an open lease can be extended.
export type LeaseChange =
  | { kind: 'extend' | 'release' | 'ack'; expiresAt: number }
  | { kind: 'done' }
  // A finished task adds to its queue's count once.
  | { kind: 'counted' };

export const LOCK_PREFIX = 'lock#';
const STATE_PREFIX = 'state#';
const STATE_SECONDS = 90 * 86400;

const sqs = new SQSClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const table = () => {
  const name = process.env.TASK_LEASES_TABLE;
  if (!name) throw new Error('TASK_LEASES_TABLE is not set');
  return name;
};
// Expired leases are deleted by TTL a while after they stop counting.
const DELETE_AFTER = 24 * 3600;

export const sqsTaskQueue: TaskQueue = {
  async receive(url, visibility, max) {
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: max,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        VisibilityTimeout: visibility,
      }),
    );
    return (result.Messages ?? []).flatMap((message) =>
      message.ReceiptHandle && message.MessageId
        ? [
            {
              messageId: message.MessageId,
              receiptHandle: message.ReceiptHandle,
              body: message.Body ?? '',
              receiveCount: Number(
                message.Attributes?.ApproximateReceiveCount ?? 1,
              ),
            },
          ]
        : [],
    );
  },
  async remove(url, receiptHandle) {
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }),
    );
  },
  async visibility(url, receiptHandle, seconds) {
    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: url,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  },
  async depth(url) {
    const result = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return result.Attributes?.ApproximateNumberOfMessages ?? 'Unknown';
  },
};

export const dynamoLeaseTable: LeaseTable = {
  async put(lease) {
    await dynamo.send(
      new PutCommand({
        TableName: table(),
        Item: { ...lease, deleteAfter: lease.expiresAt + DELETE_AFTER },
      }),
    );
  },
  async get(userId, leaseId) {
    const result = await dynamo.send(
      new GetCommand({
        TableName: table(),
        Key: { userId, leaseId },
        ConsistentRead: true,
      }),
    );
    return (result.Item as Lease | undefined) ?? null;
  },
  async active(userId) {
    const leases: Lease[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const result: QueryCommandOutput = await dynamo.send(
        new QueryCommand({
          TableName: table(),
          IndexName: 'byExpiry',
          KeyConditionExpression: 'userId = :user AND expiresAt > :now',
          ConsistentRead: true,
          ExpressionAttributeValues: {
            ':user': userId,
            ':now': Math.floor(Date.now() / 1000),
          },
          ExclusiveStartKey: start,
        }),
      );
      leases.push(
        ...((result.Items as Lease[]) ?? []).filter(
          (l) => !l.leaseId.startsWith(LOCK_PREFIX),
        ),
      );
      start = result.LastEvaluatedKey;
    } while (start);
    return leases;
  },
  async lock(userId, name, seconds) {
    const now = Math.floor(Date.now() / 1000);
    try {
      await dynamo.send(
        new PutCommand({
          TableName: table(),
          Item: {
            userId,
            leaseId: `${LOCK_PREFIX}${name}`,
            expiresAt: now + seconds,
            deleteAfter: now + seconds + DELETE_AFTER,
          },
          ConditionExpression:
            'attribute_not_exists(leaseId) OR expiresAt < :now',
          ExpressionAttributeValues: { ':now': now },
        }),
      );
      return true;
    } catch (error) {
      if (
        (error as { name?: string }).name === 'ConditionalCheckFailedException'
      )
        return false;
      throw error;
    }
  },
  async fixGrade(userId, leaseId, grade) {
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: table(),
          Key: { userId, leaseId },
          UpdateExpression: 'SET #test.#grade = :grade',
          ConditionExpression:
            'attribute_exists(#test) AND attribute_not_exists(#test.#grade)',
          ExpressionAttributeNames: { '#test': 'test', '#grade': 'grade' },
          ExpressionAttributeValues: { ':grade': grade },
        }),
      );
    } catch (error) {
      if (
        (error as { name?: string }).name !== 'ConditionalCheckFailedException'
      )
        throw error;
    }
  },
  async unlock(userId, name) {
    await dynamo.send(
      new DeleteCommand({
        TableName: table(),
        Key: { userId, leaseId: `${LOCK_PREFIX}${name}` },
      }),
    );
  },
  async getState(userId, name) {
    const result = await dynamo.send(
      new GetCommand({
        TableName: table(),
        Key: { userId, leaseId: `${STATE_PREFIX}${name}` },
        ConsistentRead: true,
      }),
    );
    return (result.Item?.value as Row | undefined) ?? null;
  },
  // No expiresAt, so the expiry index never lists it as a lease.
  async putState(userId, name, value) {
    await dynamo.send(
      new PutCommand({
        TableName: table(),
        Item: {
          userId,
          leaseId: `${STATE_PREFIX}${name}`,
          value,
          deleteAfter: Math.floor(Date.now() / 1000) + STATE_SECONDS,
        },
      }),
    );
  },
  async transition(userId, leaseId, change) {
    const open =
      'attribute_exists(leaseId) AND attribute_not_exists(released) AND attribute_not_exists(acked)';
    const command =
      change.kind === 'counted'
        ? {
            UpdateExpression: 'SET counted = :yes',
            ConditionExpression:
              'attribute_exists(leaseId) AND attribute_not_exists(counted)',
            ExpressionAttributeValues: { ':yes': true },
          }
        : change.kind === 'done'
          ? {
              UpdateExpression: 'SET done = :yes',
              ConditionExpression: open,
              ExpressionAttributeValues: { ':yes': true },
            }
          : {
              UpdateExpression: `SET expiresAt = :at, deleteAfter = :del${
                change.kind === 'extend'
                  ? ''
                  : `, ${change.kind === 'ack' ? 'acked' : 'released'} = :yes`
              }`,
              ConditionExpression: open,
              ExpressionAttributeValues: {
                ':at': change.expiresAt,
                ':del': change.expiresAt + DELETE_AFTER,
                ...(change.kind === 'extend' ? {} : { ':yes': true }),
              },
            };
    try {
      await dynamo.send(
        new UpdateCommand({
          TableName: table(),
          Key: { userId, leaseId },
          ...command,
        }),
      );
      return true;
    } catch (error) {
      if (
        (error as { name?: string }).name === 'ConditionalCheckFailedException'
      )
        return false;
      throw error;
    }
  },
};
