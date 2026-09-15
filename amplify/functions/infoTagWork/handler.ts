import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  createInfoTagWorkService,
  type InfoTagTables,
  type Manifest,
} from './core';
import type { InfoTagRequest } from '../../../shared/infoTagProtocol';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});
// A single immutable manifest cache bounds warm-container memory usage.
let cached: { key: string; manifest: Manifest } | undefined;
const service = createInfoTagWorkService({
  db,
  tables: JSON.parse(process.env.INFO_TAG_TABLES!) as InfoTagTables,
  async readManifest(key) {
    if (cached?.key === key) return cached.manifest;
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: process.env.OUTPUTS_BUCKET_NAME,
        Key: key,
      })
    );
    const manifest = JSON.parse(
      (await result.Body?.transformToString()) ?? ''
    ) as Manifest;
    cached = { key, manifest };
    return manifest;
  },
});

export const handler = async (event: {
  identity?: unknown;
  arguments: { request: string };
}) => {
  if (!event.arguments?.request || event.arguments.request.length > 32_000)
    throw new Error('Invalid Info Tags request');
  return service(
    event.identity,
    JSON.parse(event.arguments.request) as InfoTagRequest
  );
};
