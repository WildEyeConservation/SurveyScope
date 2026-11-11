import {
  BatchGetCommand,
  BatchWriteCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { Box } from '../../../shared/locationGeometry';
import {
  isFalseNegativeSource,
  type Point,
  type Tile,
} from '../falseNegativeSamples/sampling';

export type DataTables = {
  Location: string;
  Observation: string;
  Annotation: string;
};

export const INDEXES = {
  tilesBySet: 'locationsBySetIdAndConfidence',
  observationsBySet: 'observationsByAnnotationSetIdAndCreatedAt',
  annotationsBySet: 'annotationsBySetId',
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pooled<T>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function projection(fields: readonly string[]) {
  const names = Object.fromEntries(fields.map((field, i) => [`#p${i}`, field]));
  return {
    ProjectionExpression: Object.keys(names).join(', '),
    ExpressionAttributeNames: names as Record<string, string>,
  };
}

async function* queryPages(
  db: DynamoDBDocumentClient,
  input: {
    table: string;
    index: string;
    partitionKey: string;
    value: string;
    fields: readonly string[];
    startKey?: Record<string, unknown>;
  },
): AsyncGenerator<{
  items: Record<string, unknown>[];
  nextKey?: Record<string, unknown>;
}> {
  const projected = projection(input.fields);
  let startKey = input.startKey;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: input.table,
        IndexName: input.index,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeValues: { ':pk': input.value },
        ProjectionExpression: projected.ProjectionExpression,
        ExpressionAttributeNames: {
          ...projected.ExpressionAttributeNames,
          '#pk': input.partitionKey,
        },
        ExclusiveStartKey: startKey,
      }),
    );
    startKey = page.LastEvaluatedKey;
    yield { items: page.Items ?? [], nextKey: startKey };
  } while (startKey);
}

export type PrimaryWork = {
  // Boxes reviewed in primary work, by image.
  reviewed: Map<string, Box[]>;
  // Primary annotation points, by image.
  annotations: Map<string, Point[]>;
  // Tiles with a false-negative review, and the animals found there.
  falseNegativeReviews: Map<string, number>;
};

async function locationBoxes(
  db: DynamoDBDocumentClient,
  table: string,
  ids: readonly string[],
): Promise<Map<string, Box[]>> {
  const byImage = new Map<string, Box[]>();
  const projected = projection(['id', 'imageId', 'x', 'y', 'width', 'height']);
  await pooled(chunk(ids, 100), 16, async (batch) => {
    let keys = batch.map((id) => ({ id }));
    for (let attempt = 0; keys.length; attempt++) {
      if (attempt > 10)
        throw new Error('Location lookups kept being throttled');
      if (attempt) await sleep(Math.min(50 * 2 ** attempt, 3000));
      const { Responses, UnprocessedKeys } = await db.send(
        new BatchGetCommand({
          RequestItems: { [table]: { Keys: keys, ...projected } },
        }),
      );
      for (const item of Responses?.[table] ?? []) {
        if (typeof item.imageId !== 'string') continue;
        const boxes = byImage.get(item.imageId) ?? [];
        boxes.push({
          x: Number(item.x ?? 0),
          y: Number(item.y ?? 0),
          width: Number(item.width ?? 0),
          height: Number(item.height ?? 0),
        });
        byImage.set(item.imageId, boxes);
      }
      keys = (UnprocessedKeys?.[table]?.Keys ?? []) as { id: string }[];
    }
  });
  return byImage;
}

export async function loadPrimaryWork(
  db: DynamoDBDocumentClient,
  tables: DataTables,
  annotationSetId: string,
): Promise<PrimaryWork> {
  const reviewedLocationIds = new Set<string>();
  const falseNegativeReviews = new Map<string, number>();
  for await (const { items } of queryPages(db, {
    table: tables.Observation,
    index: INDEXES.observationsBySet,
    partitionKey: 'annotationSetId',
    value: annotationSetId,
    fields: ['locationId', 'source', 'annotationCount'],
  })) {
    for (const item of items) {
      if (typeof item.locationId !== 'string') continue;
      if (isFalseNegativeSource(item.source)) {
        if (!falseNegativeReviews.has(item.locationId)) {
          falseNegativeReviews.set(
            item.locationId,
            Number(item.annotationCount ?? 0),
          );
        }
      } else {
        reviewedLocationIds.add(item.locationId);
      }
    }
  }

  const reviewed = await locationBoxes(db, tables.Location, [
    ...reviewedLocationIds,
  ]);

  const annotations = new Map<string, Point[]>();
  for await (const { items } of queryPages(db, {
    table: tables.Annotation,
    index: INDEXES.annotationsBySet,
    partitionKey: 'setId',
    value: annotationSetId,
    fields: ['imageId', 'x', 'y', 'source'],
  })) {
    for (const item of items) {
      if (typeof item.imageId !== 'string') continue;
      if (isFalseNegativeSource(item.source)) continue;
      const points = annotations.get(item.imageId) ?? [];
      points.push({ x: Number(item.x ?? 0), y: Number(item.y ?? 0) });
      annotations.set(item.imageId, points);
    }
  }

  return { reviewed, annotations, falseNegativeReviews };
}

export async function* tilePages(
  db: DynamoDBDocumentClient,
  tables: DataTables,
  locationSetId: string,
  startKey?: Record<string, unknown>,
): AsyncGenerator<{ tiles: Tile[]; nextKey?: Record<string, unknown> }> {
  for await (const { items, nextKey } of queryPages(db, {
    table: tables.Location,
    index: INDEXES.tilesBySet,
    partitionKey: 'setId',
    value: locationSetId,
    fields: ['id', 'imageId', 'x', 'y', 'width', 'height'],
    startKey,
  })) {
    const tiles: Tile[] = [];
    for (const item of items) {
      if (typeof item.id !== 'string' || typeof item.imageId !== 'string') {
        continue;
      }
      tiles.push({
        id: item.id,
        imageId: item.imageId,
        x: Number(item.x ?? 0),
        y: Number(item.y ?? 0),
        width: Number(item.width ?? 0),
        height: Number(item.height ?? 0),
      });
    }
    yield { tiles, nextKey };
  }
}

async function deleteByIds(
  db: DynamoDBDocumentClient,
  table: string,
  ids: readonly string[],
): Promise<void> {
  await pooled(chunk(ids, 25), 8, async (batch) => {
    let pending: Record<string, unknown>[] = batch.map((id) => ({
      DeleteRequest: { Key: { id } },
    }));
    for (let attempt = 0; pending.length; attempt++) {
      if (attempt > 10) throw new Error('Deletes kept being throttled');
      if (attempt) await sleep(Math.min(100 * 2 ** attempt, 5000));
      const { UnprocessedItems } = await db.send(
        new BatchWriteCommand({ RequestItems: { [table]: pending } }),
      );
      pending = (UnprocessedItems?.[table] ?? []) as Record<string, unknown>[];
    }
  });
}

export type ResetProgress = {
  stage: number;
  cursor?: Record<string, unknown>;
};

// Resolves the place to resume from when interrupted, null when done.
export async function deleteFalseNegativeWork(
  db: DynamoDBDocumentClient,
  tables: DataTables,
  annotationSetId: string,
  from: ResetProgress,
  shouldStop: () => boolean,
): Promise<ResetProgress | null> {
  const stages = [
    {
      table: tables.Observation,
      index: INDEXES.observationsBySet,
      partitionKey: 'annotationSetId',
    },
    {
      table: tables.Annotation,
      index: INDEXES.annotationsBySet,
      partitionKey: 'setId',
    },
  ];
  for (let stage = from.stage; stage < stages.length; stage++) {
    const source = stages[stage];
    for await (const { items, nextKey } of queryPages(db, {
      ...source,
      value: annotationSetId,
      fields: ['id', 'source'],
      startKey: stage === from.stage ? from.cursor : undefined,
    })) {
      const ids = items
        .filter((item) => isFalseNegativeSource(item.source))
        .map((item) => String(item.id));
      await deleteByIds(db, source.table, ids);
      if (nextKey && shouldStop()) return { stage, cursor: nextKey };
    }
  }
  return null;
}
