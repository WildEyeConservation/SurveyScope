import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type { LaunchStore, ReferenceModel } from './launch';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const tables = () =>
  JSON.parse(process.env.API_TABLES ?? '{}') as Record<string, string>;
const bucket = () => {
  const name = process.env.OUTPUTS_BUCKET_NAME;
  if (!name) throw new Error('OUTPUTS_BUCKET_NAME is not set');
  return name;
};

export const launchStore: LaunchStore = {
  async readJson(key) {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
    );
    return JSON.parse(await object.Body!.transformToString());
  },

  async writeJson(prefix, value) {
    const key = `${prefix}${randomUUID()}.json`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: JSON.stringify(value),
        ContentType: 'application/json',
      }),
    );
    return key;
  },

  async remove(key) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },

  async projectsOf(model: ReferenceModel, ids: string[]) {
    const table = tables()[model];
    if (!table) throw new Error(`No table for ${model}`);
    const found = new Map<string, string>();
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 100)
      chunks.push(ids.slice(i, i + 100));
    for (let i = 0; i < chunks.length; i += 10) {
      await Promise.all(
        chunks.slice(i, i + 10).map(async (chunk) => {
          let keys: Record<string, unknown>[] | undefined = chunk.map((id) => ({
            id,
          }));
          while (keys?.length) {
            const result: BatchGetCommandOutput = await dynamo.send(
              new BatchGetCommand({
                RequestItems: {
                  [table]: {
                    Keys: keys,
                    ProjectionExpression: 'id, projectId',
                  },
                },
              }),
            );
            for (const item of result.Responses?.[table] ?? []) {
              found.set(String(item.id), String(item.projectId));
            }
            keys = result.UnprocessedKeys?.[table]?.Keys;
          }
        }),
      );
    }
    return found;
  },
};
