import {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { isPointInBox, type Box } from '../../../shared/locationGeometry';
import {
  coverDelta,
  isCoveredByPrimaryWork,
  isFalseNegativeSource,
  type Point,
} from './sampling';
import { createSampleStore, SUMMARY_SK, type SampleRow } from './store';

const ANNOTATIONS_BY_IMAGE = 'annotationsByImageIdAndSetId';
const OBSERVATIONS_BY_LOCATION = 'observationsByLocationId';
const SAMPLE_CACHE_MS = 60_000;

export type MarkerTables = {
  samples: string;
  Location: string;
  Annotation: string;
  Observation: string;
};

type ImageAnnotations = {
  primary: Point[];
  falseNegative: (Point & { id: string })[];
};

export function createTileMarker(
  db: DynamoDBDocumentClient,
  tables: MarkerTables,
) {
  const samples = createSampleStore(db, tables.samples);
  const sampleCache = new Map<string, { exists: boolean; at: number }>();

  async function hasSample(annotationSetId: string): Promise<boolean> {
    const cached = sampleCache.get(annotationSetId);
    if (cached && Date.now() - cached.at < SAMPLE_CACHE_MS) {
      return cached.exists;
    }
    const { Item } = await db.send(
      new GetCommand({
        TableName: tables.samples,
        Key: { annotationSetId, sk: SUMMARY_SK },
        ProjectionExpression: 'sk',
      }),
    );
    if (sampleCache.size >= 500) sampleCache.clear();
    sampleCache.set(annotationSetId, { exists: !!Item, at: Date.now() });
    return !!Item;
  }

  async function imageAnnotations(
    annotationSetId: string,
    imageId: string,
  ): Promise<ImageAnnotations> {
    const result: ImageAnnotations = { primary: [], falseNegative: [] };
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: tables.Annotation,
          IndexName: ANNOTATIONS_BY_IMAGE,
          KeyConditionExpression: 'imageId = :image AND setId = :set',
          ExpressionAttributeValues: {
            ':image': imageId,
            ':set': annotationSetId,
          },
          ProjectionExpression: 'id, x, y, #source',
          ExpressionAttributeNames: { '#source': 'source' },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        const point = { x: Number(item.x ?? 0), y: Number(item.y ?? 0) };
        if (isFalseNegativeSource(item.source)) {
          result.falseNegative.push({ ...point, id: String(item.id) });
        } else {
          result.primary.push(point);
        }
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return result;
  }

  async function deleteItems(
    table: string,
    ids: readonly string[],
  ): Promise<void> {
    for (let i = 0; i < ids.length; i += 25) {
      let pending: Record<string, unknown>[] = ids
        .slice(i, i + 25)
        .map((id) => ({ DeleteRequest: { Key: { id } } }));
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt > 8) throw new Error('Deletes kept failing');
        const { UnprocessedItems } = await db.send(
          new BatchWriteCommand({ RequestItems: { [table]: pending } }),
        );
        pending = (UnprocessedItems?.[table] ?? []) as Record<
          string,
          unknown
        >[];
      }
    }
  }

  async function tileReviewIds(row: SampleRow): Promise<string[]> {
    const ids: string[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const page = await db.send(
        new QueryCommand({
          TableName: tables.Observation,
          IndexName: OBSERVATIONS_BY_LOCATION,
          KeyConditionExpression: 'locationId = :tile',
          ExpressionAttributeValues: { ':tile': row.tileId },
          ProjectionExpression: 'id, annotationSetId, #source',
          ExpressionAttributeNames: { '#source': 'source' },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of page.Items ?? []) {
        if (
          item.annotationSetId === row.annotationSetId &&
          isFalseNegativeSource(item.source)
        ) {
          ids.push(String(item.id));
        }
      }
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return ids;
  }

  async function coverRow(
    row: SampleRow,
    annotations?: ImageAnnotations,
  ): Promise<boolean> {
    const delta = coverDelta(row);
    if (!delta) return false;
    // Removed so later primary launches do not skip this ground, and before
    // the status changes so a failed attempt is retried.
    if (row.status === 'reviewed') {
      await deleteItems(tables.Observation, await tileReviewIds(row));
      if (row.found) {
        const onImage =
          annotations ??
          (await imageAnnotations(row.annotationSetId, row.imageId));
        await deleteItems(
          tables.Annotation,
          onImage.falseNegative
            .filter((annotation) =>
              isPointInBox(annotation.x, annotation.y, row),
            )
            .map((annotation) => annotation.id),
        );
      }
    }
    return samples.transitionRow(row.annotationSetId, row.tileId, {
      from: [row.status],
      to: 'covered',
      set: { coveredAt: new Date().toISOString() },
      delta,
    });
  }

  async function onObservation(
    observation: Record<string, unknown>,
  ): Promise<void> {
    const { annotationSetId, locationId } = observation;
    if (typeof annotationSetId !== 'string' || typeof locationId !== 'string') {
      return;
    }
    if (!(await hasSample(annotationSetId))) return;

    if (isFalseNegativeSource(observation.source)) {
      const found = Math.max(
        0,
        Math.round(Number(observation.annotationCount ?? 0)),
      );
      await samples.transitionRow(annotationSetId, locationId, {
        from: ['pending'],
        to: 'reviewed',
        set: {
          found,
          reviewedAt:
            typeof observation.createdAt === 'string'
              ? observation.createdAt
              : new Date().toISOString(),
        },
        delta: { reviewedCount: 1, foundCount: found },
      });
      return;
    }

    const { Item: location } = await db.send(
      new GetCommand({
        TableName: tables.Location,
        Key: { id: locationId },
        ProjectionExpression: 'imageId, x, y, width, height',
      }),
    );
    if (typeof location?.imageId !== 'string') return;
    const rows = (
      await samples.rowsForImage(annotationSetId, location.imageId)
    ).filter((row) => row.status !== 'covered');
    if (rows.length === 0) return;

    const box: Box = {
      x: Number(location.x ?? 0),
      y: Number(location.y ?? 0),
      width: Number(location.width ?? 0),
      height: Number(location.height ?? 0),
    };
    // Annotations can sit outside the reviewed box, in another tile.
    const annotations =
      Number(observation.annotationCount ?? 0) > 0 ||
      rows.some((row) => row.status === 'reviewed' && row.found)
        ? await imageAnnotations(annotationSetId, location.imageId)
        : undefined;
    for (const row of rows) {
      if (isCoveredByPrimaryWork(row, [box], annotations?.primary)) {
        await coverRow(row, annotations);
      }
    }
  }

  return { onObservation, coverRow, imageAnnotations };
}
