import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';
import type {
  DispatchTargets,
  ImageRef,
  LaunchStore,
  ReferenceModel,
} from './launch';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const ssm = new SSMClient({});

let targets: Promise<DispatchTargets> | undefined;

const tables = () =>
  JSON.parse(process.env.API_TABLES ?? '{}') as Record<string, string>;
const bucket = () => {
  const name = process.env.OUTPUTS_BUCKET_NAME;
  if (!name) throw new Error('OUTPUTS_BUCKET_NAME is not set');
  return name;
};

const MAX_ATTEMPTS = 8;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function batchGet(
  model: string,
  ids: string[],
  projection: string,
): Promise<Record<string, unknown>[]> {
  const table = tables()[model];
  if (!table) throw new Error(`No table for ${model}`);
  const unique = [...new Set(ids)];
  const items: Record<string, unknown>[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 100)
    chunks.push(unique.slice(i, i + 100));
  for (let i = 0; i < chunks.length; i += 10) {
    await Promise.all(
      chunks.slice(i, i + 10).map(async (chunk) => {
        let keys: Record<string, unknown>[] | undefined = chunk.map((id) => ({
          id,
        }));
        for (let attempt = 0; keys?.length; attempt++) {
          if (attempt === MAX_ATTEMPTS)
            throw new Error(`${model} lookups were not processed`);
          if (attempt > 0)
            await sleep(Math.random() * 50 * 2 ** Math.min(attempt, 6));
          const result: BatchGetCommandOutput = await dynamo.send(
            new BatchGetCommand({
              RequestItems: {
                [table]: { Keys: keys, ProjectionExpression: projection },
              },
            }),
          );
          items.push(...(result.Responses?.[table] ?? []));
          keys = result.UnprocessedKeys?.[table]?.Keys;
        }
      }),
    );
  }
  return items;
}

export const launchStore: LaunchStore = {
  async readJson(key, beforeParse) {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
    );
    const projectId = object.Metadata?.['project-id'];
    try {
      await beforeParse?.(projectId);
      if ((object.ContentLength ?? 0) > MAX_FILE_BYTES)
        throw new Error('The file is too large');
    } catch (error) {
      (object.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw error;
    }
    return {
      value: JSON.parse(await object.Body!.transformToString()),
      projectId,
    };
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
    const found = new Map<string, string>();
    for (const item of await batchGet(model, ids, 'id, projectId'))
      found.set(String(item.id), String(item.projectId));
    return found;
  },

  async imagesOf(ids) {
    const found = new Map<string, ImageRef>();
    for (const item of await batchGet(
      'Image',
      ids,
      'id, projectId, originalPath',
    )) {
      found.set(String(item.id), {
        projectId: String(item.projectId),
        originalPath:
          typeof item.originalPath === 'string' ? item.originalPath : null,
      });
    }
    return found;
  },

  async dispatchTargets() {
    targets ??= ssm
      .send(
        new GetParameterCommand({
          Name: process.env.DISPATCH_TARGETS_PARAMETER,
        }),
      )
      .then((r) => JSON.parse(r.Parameter?.Value ?? '{}'));
    try {
      return await targets;
    } catch (error) {
      targets = undefined;
      if ((error as Error).name === 'ParameterNotFound') return null;
      throw error;
    }
  },
};
