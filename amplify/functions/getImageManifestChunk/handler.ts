import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { GetImageManifestChunkHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import { isManifestField } from '../../../shared/imageManifest';
import { readChunk } from './core';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tables = JSON.parse(process.env.IMAGE_MANIFEST_TABLES!) as {
  Project: string;
  Image: string;
};

export const handler: GetImageManifestChunkHandler = async (event) => {
  const { projectId, cursor } = event.arguments;
  if (!projectId) throw new Error('projectId is required');
  const requested = [...new Set(event.arguments.fields)];
  const fields = requested.filter(isManifestField);
  if (fields.length !== requested.length) {
    throw new Error(`Unsupported fields: ${requested.join(', ')}`);
  }
  const projected = ['id', ...fields];

  const project = await db.send(
    new GetCommand({
      TableName: tables.Project,
      Key: { id: projectId },
      ProjectionExpression: 'organizationId',
    })
  );
  const organizationId = project.Item?.organizationId as string | undefined;
  if (!organizationId) throw new Error(`Project ${projectId} not found`);
  authorizeRequest(event.identity, organizationId);

  // AppSync caps resolver responses at 5 MB and requests at 30 s.
  return readChunk(
    (startKey, limit) =>
      db.send(
        new QueryCommand({
          TableName: tables.Image,
          IndexName: 'imagesByProjectId',
          KeyConditionExpression: 'projectId = :projectId',
          ExpressionAttributeValues: { ':projectId': projectId },
          ExclusiveStartKey: startKey,
          Limit: limit,
          ProjectionExpression: projected.map((_, i) => `#f${i}`).join(', '),
          ExpressionAttributeNames: Object.fromEntries(
            projected.map((name, i) => [`#f${i}`, name])
          ),
        })
      ),
    projectId,
    cursor,
    fields,
    { maxPayloadBytes: 4_000_000, rowTarget: 80_000, readDeadlineMs: 15_000 }
  );
};
