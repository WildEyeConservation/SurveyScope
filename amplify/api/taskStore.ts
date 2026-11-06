import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
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
  expire(userId: string, leaseId: string, expiresAt: number): Promise<void>;
}

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
          KeyConditionExpression: 'userId = :user',
          FilterExpression: 'expiresAt > :now',
          ExpressionAttributeValues: {
            ':user': userId,
            ':now': Math.floor(Date.now() / 1000),
          },
          ExclusiveStartKey: start,
        }),
      );
      leases.push(...((result.Items as Lease[]) ?? []));
      start = result.LastEvaluatedKey;
    } while (start);
    return leases;
  },
  async expire(userId, leaseId, expiresAt) {
    await dynamo.send(
      new UpdateCommand({
        TableName: table(),
        Key: { userId, leaseId },
        UpdateExpression: 'SET expiresAt = :at, deleteAfter = :del',
        ConditionExpression: 'attribute_exists(leaseId)',
        ExpressionAttributeValues: {
          ':at': expiresAt,
          ':del': expiresAt + DELETE_AFTER,
        },
      }),
    );
  },
};
