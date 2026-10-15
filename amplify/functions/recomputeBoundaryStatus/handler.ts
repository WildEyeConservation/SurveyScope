import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import pLimit from 'p-limit';
import type { RecomputeBoundaryStatusHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  boundaryStatusChange,
  runSerialized,
  type RecomputeLease,
} from './core';
import {
  createBoundaryClassifier,
  type BoundaryStatus,
  type LatLngRing,
} from '../../../shared/boundaryStatus';

type Tables = {
  Project: string;
  Image: string;
  Shapefile: string;
  ShapefileExclusions: string;
};

type ImageRow = {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  boundaryStatus?: BoundaryStatus | null;
};

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambda = new LambdaClient({});
const tables = JSON.parse(process.env.BOUNDARY_TABLES!) as Tables;
const UPDATE_CONCURRENCY = 25;

async function queryAll<T>(
  tableName: string,
  indexName: string,
  projectId: string,
  projection: string[],
  onPage: (items: T[]) => Promise<void>
): Promise<void> {
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: 'projectId = :projectId',
        ExpressionAttributeValues: { ':projectId': projectId },
        ProjectionExpression: projection.map((_, i) => `#p${i}`).join(', '),
        ExpressionAttributeNames: Object.fromEntries(
          projection.map((name, i) => [`#p${i}`, name])
        ),
        ExclusiveStartKey,
      })
    );
    await onPage((page.Items ?? []) as T[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
}

function unflatten(coordinates: unknown): LatLngRing | null {
  const flat = (Array.isArray(coordinates) ? coordinates : []).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n)
  );
  const ring: LatLngRing = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    ring.push([flat[i], flat[i + 1]]);
  return ring.length >= 3 ? ring : null;
}

async function loadArea(projectId: string) {
  const boundaries: Array<{ coordinates?: unknown; marginM?: number | null }> =
    [];
  await queryAll<(typeof boundaries)[number]>(
    tables.Shapefile,
    'shapefilesByProjectId',
    projectId,
    ['coordinates', 'marginM'],
    async (items) => {
      boundaries.push(...items);
    }
  );
  const exclusions: LatLngRing[] = [];
  await queryAll<{ coordinates?: unknown }>(
    tables.ShapefileExclusions,
    'shapefileExclusionsByProjectId',
    projectId,
    ['coordinates'],
    async (items) => {
      for (const item of items) {
        const ring = unflatten(item.coordinates);
        if (ring) exclusions.push(ring);
      }
    }
  );
  return {
    boundary: unflatten(boundaries[0]?.coordinates),
    exclusions,
    marginM: Number(boundaries[0]?.marginM) || 0,
  };
}

const LEASE_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const TIME_RESERVE_MS = 2 * 60 * 1000;
const isConditionFailure = (error: unknown) =>
  (error as Error)?.name === 'ConditionalCheckFailedException';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class OutOfTime extends Error {}

type ProjectLease = RecomputeLease & {
  held: boolean;
  extend(): Promise<void>;
  handOff(): Promise<void>;
  abandon(): Promise<void>;
};

function projectLease(projectId: string): ProjectLease {
  let token: string | null = null;
  const update = async (
    UpdateExpression: string,
    values: Record<string, unknown>,
    ConditionExpression?: string
  ) => {
    try {
      await db.send(
        new UpdateCommand({
          TableName: tables.Project,
          Key: { id: projectId },
          UpdateExpression,
          ConditionExpression,
          ExpressionAttributeValues: values,
        })
      );
      return true;
    } catch (error) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  };
  const nextToken = () => new Date(Date.now() + LEASE_MS).toISOString();
  return {
    held: false,
    async acquire() {
      const until = nextToken();
      this.held = await update(
        'SET boundaryRecomputeLeaseUntil = :until, boundaryRecomputeRequested = :false',
        { ':until': until, ':false': false, ':now': new Date().toISOString() },
        'attribute_not_exists(boundaryRecomputeLeaseUntil) OR boundaryRecomputeLeaseUntil < :now'
      );
      if (this.held) token = until;
      return this.held;
    },
    async current() {
      const result = await db.send(
        new GetCommand({
          TableName: tables.Project,
          Key: { id: projectId },
          ProjectionExpression: 'boundaryRecomputeLeaseUntil',
          ConsistentRead: true,
        })
      );
      return (result.Item?.boundaryRecomputeLeaseUntil as string) ?? null;
    },
    async extend() {
      const until = nextToken();
      if (
        !(await update(
          'SET boundaryRecomputeLeaseUntil = :until',
          { ':until': until, ':token': token },
          'boundaryRecomputeLeaseUntil = :token'
        ))
      ) {
        this.held = false;
        throw new Error('Lost the boundary recompute lease');
      }
      token = until;
    },
    async release() {
      const released = await update(
        'REMOVE boundaryRecomputeLeaseUntil',
        { ':token': token, ':true': true },
        'boundaryRecomputeLeaseUntil = :token AND (attribute_not_exists(boundaryRecomputeRequested) OR boundaryRecomputeRequested <> :true)'
      );
      if (released) this.held = false;
      return released;
    },
    async renew() {
      const until = nextToken();
      if (
        !(await update(
          'SET boundaryRecomputeLeaseUntil = :until, boundaryRecomputeRequested = :false',
          { ':until': until, ':false': false, ':token': token },
          'boundaryRecomputeLeaseUntil = :token'
        ))
      ) {
        this.held = false;
        throw new Error('Lost the boundary recompute lease');
      }
      token = until;
    },
    async handOff() {
      await update(
        'REMOVE boundaryRecomputeLeaseUntil SET boundaryRecomputeRequested = :true',
        { ':true': true, ':token': token },
        'boundaryRecomputeLeaseUntil = :token'
      );
      this.held = false;
    },
    async abandon() {
      await update(
        'REMOVE boundaryRecomputeLeaseUntil SET boundaryRecomputeRequested = :false',
        { ':false': false, ':token': token },
        'boundaryRecomputeLeaseUntil = :token'
      );
      this.held = false;
    },
  };
}

async function recompute(
  projectId: string,
  lease: ProjectLease,
  remainingMs: () => number
) {
  const classify = createBoundaryClassifier(await loadArea(projectId));
  const limit = pLimit(UPDATE_CONCURRENCY);
  const counts = { images: 0, updated: 0, inside: 0, outside: 0, excluded: 0 };
  let leaseError: unknown;
  let beat: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    beat = lease.extend().catch((error) => {
      leaseError = error;
    });
  }, HEARTBEAT_MS);
  try {
    await queryAll<ImageRow>(
      tables.Image,
      'imagesByProjectId',
      projectId,
      ['id', 'latitude', 'longitude', 'boundaryStatus'],
      async (images) => {
        const writes: Promise<void>[] = [];
        for (const image of images) {
          counts.images += 1;
          const next = classify(image.latitude, image.longitude);
          counts[next ?? 'inside'] += 1;
          const change = boundaryStatusChange(image.boundaryStatus, next);
          if (change === 'skip') continue;
          const now = new Date().toISOString();
          writes.push(
            limit(async () => {
              if (leaseError) throw leaseError;
              try {
                await db.send(
                  new UpdateCommand({
                    TableName: tables.Image,
                    Key: { id: image.id },
                    ConditionExpression: 'attribute_exists(id)',
                    ...(change === 'set'
                      ? {
                          UpdateExpression:
                            'SET boundaryStatus = :status, updatedAt = :now',
                          ExpressionAttributeValues: {
                            ':status': next,
                            ':now': now,
                          },
                        }
                      : {
                          UpdateExpression:
                            'REMOVE boundaryStatus SET updatedAt = :now',
                          ExpressionAttributeValues: { ':now': now },
                        }),
                  })
                );
                counts.updated += 1;
              } catch (error) {
                // The image was deleted while this ran.
                if (!isConditionFailure(error)) throw error;
              }
            })
          );
        }
        const failed = (await Promise.allSettled(writes)).find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
        );
        if (failed) throw failed.reason;
        if (leaseError) throw leaseError;
        if (remainingMs() < TIME_RESERVE_MS) throw new OutOfTime();
      }
    );
  } finally {
    clearInterval(heartbeat);
    await beat;
  }
  console.log('Boundary status recomputed', { projectId, ...counts });
}

export const handler: RecomputeBoundaryStatusHandler = async (
  event,
  context
) => {
  const projectId = event.arguments?.projectId;
  if (!projectId) throw new Error('projectId is required');

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

  // The client sets this too, before invoking, so the UI sees the run pending.
  await db.send(
    new UpdateCommand({
      TableName: tables.Project,
      Key: { id: projectId },
      UpdateExpression: 'SET boundaryRecomputeRequested = :true',
      ExpressionAttributeValues: { ':true': true },
    })
  );
  const lease = projectLease(projectId);
  const remainingMs = () => context.getRemainingTimeInMillis();
  try {
    const passes = await runSerialized(
      lease,
      () => recompute(projectId, lease, remainingMs),
      { sleep, holderCheckMs: HEARTBEAT_MS + 15 * 1000 }
    );
    return { passes };
  } catch (error) {
    if (error instanceof OutOfTime) {
      await lease.handOff();
      await lambda.send(
        new InvokeCommand({
          FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
          InvocationType: 'Event',
          Payload: JSON.stringify({ arguments: { projectId } }),
        })
      );
      return { handedOff: true };
    }
    if (lease.held) await lease.abandon();
    throw error;
  }
};
