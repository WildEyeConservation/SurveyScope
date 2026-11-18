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
  expire(
    userId: string,
    leaseId: string,
    expiresAt: number,
    acked?: boolean,
  ): Promise<void>;
  // A short exclusive hold, so a check and the writes it allows cannot interleave.
  lock(userId: string, name: string, seconds: number): Promise<boolean>;
  fixGrade(
    userId: string,
    leaseId: string,
    grade: NonNullable<NonNullable<Lease['test']>['grade']>,
  ): Promise<void>;
  unlock(userId: string, name: string): Promise<void>;
}

export const LOCK_PREFIX = 'lock#';

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
  async expire(userId, leaseId, expiresAt, acked = false) {
    await dynamo.send(
      new UpdateCommand({
        TableName: table(),
        Key: { userId, leaseId },
        UpdateExpression: `SET expiresAt = :at, deleteAfter = :del${acked ? ', acked = :acked' : ''}`,
        ConditionExpression: 'attribute_exists(leaseId)',
        ExpressionAttributeValues: {
          ':at': expiresAt,
          ':del': expiresAt + DELETE_AFTER,
          ...(acked ? { ':acked': true } : {}),
        },
      }),
    );
  },
};
