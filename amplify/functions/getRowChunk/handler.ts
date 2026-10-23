import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { GetRowChunkHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  chunkFields,
  rowSource,
  unknownFields,
  type RowScope,
} from '../../../shared/rowSources';
import { decodeCursor, readChunk } from './core';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const tables = JSON.parse(process.env.ROW_CHUNK_TABLES!) as Record<
  string,
  string
>;

async function getItem(model: string, id: string, attribute: string) {
  const { Item } = await db.send(
    new GetCommand({
      TableName: tables[model],
      Key: { id },
      ProjectionExpression: '#a',
      ExpressionAttributeNames: { '#a': attribute },
    })
  );
  const value = Item?.[attribute];
  if (typeof value !== 'string') throw new Error(`${model} ${id} not found`);
  return value;
}

async function organizationOf(scope: RowScope, scopeId: string) {
  const projectId =
    scope === 'project'
      ? scopeId
      : await getItem('AnnotationSet', scopeId, 'projectId');
  return getItem('Project', projectId, 'organizationId');
}

export const handler: GetRowChunkHandler = async (event) => {
  const { scopeId, cursor, beginsWith } = event.arguments;
  const source = rowSource(event.arguments.source);
  if (!source) throw new Error(`Unknown source ${event.arguments.source}`);
  if (!scopeId) throw new Error('scopeId is required');
  const requested = event.arguments.fields.filter(
    (field): field is string => typeof field === 'string'
  );
  const unknown = unknownFields(source, requested);
  if (unknown.length)
    throw new Error(`Unsupported fields: ${unknown.join(', ')}`);
  if (beginsWith != null && !source.sortKey) {
    throw new Error('This source has no sort key to filter on');
  }

  authorizeRequest(event.identity, await organizationOf(source.scope, scopeId));

  const projected = chunkFields(source, requested);
  const names = Object.fromEntries(
    projected.map((name, i) => [`#f${i}`, name])
  );
  const values: Record<string, unknown> = { ':scope': scopeId };
  let condition = '#pk = :scope';
  if (beginsWith != null && source.sortKey) {
    condition += ' AND begins_with(#sk, :prefix)';
    values[':prefix'] = beginsWith;
  }

  // AppSync caps resolver responses at 5 MB and requests at 30 s.
  return readChunk(
    (startKey, limit) =>
      db.send(
        new QueryCommand({
          TableName: tables[source.model],
          IndexName: source.index,
          KeyConditionExpression: condition,
          ExpressionAttributeValues: values,
          ExclusiveStartKey: startKey,
          Limit: limit,
          ProjectionExpression: Object.keys(names).join(', '),
          ExpressionAttributeNames: {
            ...names,
            '#pk': source.partitionKey,
            ...(source.sortKey && beginsWith != null
              ? { '#sk': source.sortKey }
              : {}),
          },
        })
      ),
    source,
    decodeCursor(source, scopeId, cursor),
    requested,
    { maxPayloadBytes: 4_000_000, rowTarget: 80_000, readDeadlineMs: 15_000 }
  );
};
