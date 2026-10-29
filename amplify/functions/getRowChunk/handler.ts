import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { GetRowChunkHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  rowSource,
  SCOPE_MODELS,
  splitJoined,
  unknownFields,
  type RowScope,
} from '../../../shared/rowSources';
import { decodeCursor, joinRows, readChunk } from './core';

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
    }),
  );
  const value = Item?.[attribute];
  if (typeof value !== 'string') throw new Error(`${model} ${id} not found`);
  return value;
}

async function projectOf(scope: RowScope, scopeId: string) {
  return scope === 'project'
    ? scopeId
    : getItem(SCOPE_MODELS[scope], scopeId, 'projectId');
}

async function batchGet(
  model: string,
  ids: string[],
  attributes: readonly string[],
) {
  const projected = Array.from(new Set(['id', 'projectId', ...attributes]));
  const names = Object.fromEntries(
    projected.map((name, i) => [`#j${i}`, name]),
  );
  const table = tables[model];
  const { Responses, UnprocessedKeys } = await db.send(
    new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: ids.map((id) => ({ id })),
          ProjectionExpression: Object.keys(names).join(', '),
          ExpressionAttributeNames: names,
        },
      },
    }),
  );
  return {
    items: Responses?.[table] ?? [],
    unprocessed: (UnprocessedKeys?.[table]?.Keys ?? []).map((key) =>
      String(key.id),
    ),
  };
}

export const handler: GetRowChunkHandler = async (event) => {
  const { scopeId, cursor, beginsWith } = event.arguments;
  const numeric = event.arguments.between?.filter(
    (bound): bound is number => typeof bound === 'number',
  );
  const text = event.arguments.betweenText?.filter(
    (bound): bound is string => typeof bound === 'string',
  );
  if (numeric && text) throw new Error('Pass between or betweenText, not both');
  const between: (number | string)[] | undefined = numeric ?? text;
  const source = rowSource(event.arguments.source);
  if (!source) throw new Error(`Unknown source ${event.arguments.source}`);
  if (!scopeId) throw new Error('scopeId is required');
  const requested = event.arguments.fields.filter(
    (field): field is string => typeof field === 'string',
  );
  const unknown = unknownFields(source, requested);
  if (unknown.length)
    throw new Error(`Unsupported fields: ${unknown.join(', ')}`);
  if ((beginsWith != null || between) && !source.sortKey) {
    throw new Error('This source has no sort key to filter on');
  }
  if (between && (between.length !== 2 || beginsWith != null)) {
    throw new Error('between takes two bounds and excludes beginsWith');
  }

  const projectId = await projectOf(source.scope, scopeId);
  authorizeRequest(
    event.identity,
    await getItem('Project', projectId, 'organizationId'),
  );

  const { own, joined } = splitJoined(source, requested);
  const projected = Array.from(new Set([...source.key, ...own]));
  const names = Object.fromEntries(
    projected.map((name, i) => [`#f${i}`, name]),
  );
  const values: Record<string, unknown> = { ':scope': scopeId };
  let condition = '#pk = :scope';
  if (beginsWith != null && source.sortKey) {
    condition += ' AND begins_with(#sk, :prefix)';
    values[':prefix'] = beginsWith;
  } else if (between && source.sortKey) {
    condition += ' AND #sk BETWEEN :low AND :high';
    values[':low'] = between[0];
    values[':high'] = between[1];
  }
  const join = joined.length ? source.join : undefined;

  // AppSync caps resolver responses at 5 MB and requests at 30 s.
  return readChunk(
    async (startKey, limit) => {
      const page = await db.send(
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
            ...(source.sortKey && (beginsWith != null || between)
              ? { '#sk': source.sortKey }
              : {}),
          },
        }),
      );
      if (!join || !page.Items) return page;
      return {
        ...page,
        // A reference may point outside the authorized project.
        Items: await joinRows(
          page.Items,
          join,
          joined,
          (ids) => batchGet(join.model, ids, joined),
          (item) => item.projectId === projectId,
        ),
      };
    },
    source,
    decodeCursor(source, scopeId, cursor),
    requested,
    { maxPayloadBytes: 4_000_000, rowTarget: 80_000, readDeadlineMs: 15_000 },
  );
};
