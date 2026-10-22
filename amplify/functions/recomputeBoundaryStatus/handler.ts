import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import type { RecomputeBoundaryStatusHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  boundaryStatusChange,
  planStrata,
  runSerialized,
  type DesignImage,
  type RecomputeLease,
} from './core';
import {
  createBoundaryClassifier,
  isOnEffort,
  type BoundaryStatus,
  type LatLngRing,
} from '../../../shared/boundaryStatus';

type Tables = {
  Project: string;
  Image: string;
  Shapefile: string;
  ShapefileExclusions: string;
  Stratum: string;
  Transect: string;
};

type ImageRow = {
  id: string;
  timestamp?: number | string | null;
  cameraId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  boundaryStatus?: BoundaryStatus | null;
  transectId?: string | null;
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

// Mixed second/millisecond timestamps -> milliseconds.
function toMillis(ts: unknown): number {
  const n = typeof ts === 'string' ? Number(ts) : Number(ts ?? NaN);
  return n > 0 && n < 1e12 ? n * 1000 : n;
}

const finiteOrNull = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

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

// Model rows written here bypass AppSync, so updatedAt is set by hand.
async function updateRow(
  TableName: string,
  id: string,
  set: Record<string, unknown>,
  remove: string[] = [],
  expect: Record<string, unknown> = {}
): Promise<boolean> {
  const fields = { ...set, updatedAt: new Date().toISOString() };
  const names = Object.keys(fields);
  const expected = Object.keys(expect);
  try {
    await db.send(
      new UpdateCommand({
        TableName,
        Key: { id },
        ConditionExpression: [
          'attribute_exists(id)',
          ...expected.map((name, i) =>
            expect[name] === null
              ? `attribute_not_exists(#e${i})`
              : `#e${i} = :e${i}`
          ),
        ].join(' AND '),
        UpdateExpression: [
          `SET ${names.map((_, i) => `#s${i} = :s${i}`).join(', ')}`,
          remove.length
            ? `REMOVE ${remove.map((_, i) => `#r${i}`).join(', ')}`
            : '',
        ].join(' '),
        ExpressionAttributeNames: Object.fromEntries([
          ...names.map((name, i) => [`#s${i}`, name]),
          ...remove.map((name, i) => [`#r${i}`, name]),
          ...expected.map((name, i) => [`#e${i}`, name]),
        ]),
        ExpressionAttributeValues: Object.fromEntries([
          ...names.map((name, i) => [
            `:s${i}`,
            fields[name as keyof typeof fields],
          ]),
          ...expected
            .filter((name) => expect[name] !== null)
            .map((name) => [`:e${expected.indexOf(name)}`, expect[name]]),
        ]),
      })
    );
    return true;
  } catch (error) {
    // The row was deleted or changed while this ran.
    if (!isConditionFailure(error)) throw error;
    return false;
  }
}

async function loadStrataInputs(projectId: string) {
  const strata: { id: string; coords: LatLngRing; offEffort: boolean }[] = [];
  await queryAll<{ id: string; coordinates?: unknown; offEffort?: boolean }>(
    tables.Stratum,
    'strataByProjectId',
    projectId,
    ['id', 'coordinates', 'offEffort'],
    async (items) => {
      for (const item of items) {
        strata.push({
          id: item.id,
          coords: unflatten(item.coordinates) ?? [],
          offEffort: !!item.offEffort,
        });
      }
    }
  );
  const transects: { id: string; stratumId: string | null }[] = [];
  await queryAll<{ id: string; stratumId?: string | null }>(
    tables.Transect,
    'transectsByProjectId',
    projectId,
    ['id', 'stratumId'],
    async (items) => {
      for (const item of items) {
        transects.push({ id: item.id, stratumId: item.stratumId ?? null });
      }
    }
  );
  return { strata, transects };
}

// Transects need a stratum, so a survey without any gets one for its boundary.
async function createDefaultStratum(
  projectId: string,
  group: string,
  boundary: LatLngRing
) {
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.send(
    new PutCommand({
      TableName: tables.Stratum,
      Item: {
        id,
        __typename: 'Stratum',
        projectId,
        name: 'Stratum 1',
        coordinates: boundary.flat(),
        group,
        createdAt: now,
        updatedAt: now,
      },
    })
  );
  return { id, coords: boundary, offEffort: false };
}

async function recompute(
  projectId: string,
  group: string,
  lease: ProjectLease,
  remainingMs: () => number
) {
  const area = await loadArea(projectId);
  const classify = createBoundaryClassifier(area);
  const limit = pLimit(UPDATE_CONCURRENCY);
  const counts = { images: 0, updated: 0, inside: 0, outside: 0, excluded: 0 };
  const designImages: DesignImage[] = [];
  let leaseError: unknown;
  let beat: Promise<void> = Promise.resolve();
  const heartbeat = setInterval(() => {
    beat = lease.extend().catch((error) => {
      leaseError = error;
    });
  }, HEARTBEAT_MS);
  const runWrites = async (tasks: (() => Promise<void>)[]) => {
    const failed = (
      await Promise.allSettled(
        tasks.map((task) =>
          limit(async () => {
            if (leaseError) throw leaseError;
            if (remainingMs() < TIME_RESERVE_MS) throw new OutOfTime();
            await task();
          })
        )
      )
    ).find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failed) throw failed.reason;
    if (leaseError) throw leaseError;
    if (remainingMs() < TIME_RESERVE_MS) throw new OutOfTime();
  };
  const statuses = new Map<
    string,
    { current: BoundaryStatus | null | undefined; next: BoundaryStatus | null }
  >();
  try {
    await queryAll<ImageRow>(
      tables.Image,
      'imagesByProjectId',
      projectId,
      [
        'id',
        'timestamp',
        'cameraId',
        'latitude',
        'longitude',
        'boundaryStatus',
        'transectId',
      ],
      async (images) => {
        for (const image of images) {
          counts.images += 1;
          const next = classify(image.latitude, image.longitude);
          counts[next ?? 'inside'] += 1;
          statuses.set(image.id, { current: image.boundaryStatus, next });
          designImages.push({
            id: image.id,
            timestamp: toMillis(image.timestamp),
            cameraId: image.cameraId ?? null,
            latitude: finiteOrNull(image.latitude),
            longitude: finiteOrNull(image.longitude),
            onEffort: isOnEffort(next),
            wasOnEffort: isOnEffort(image.boundaryStatus),
            transectId: image.transectId ?? null,
          });
        }
        if (leaseError) throw leaseError;
        if (remainingMs() < TIME_RESERVE_MS) throw new OutOfTime();
      }
    );

    const inputs = await loadStrataInputs(projectId);
    if (
      area.boundary &&
      inputs.transects.length > 0 &&
      !inputs.strata.some((st) => !st.offEffort)
    ) {
      inputs.strata.push(
        await createDefaultStratum(projectId, group, area.boundary)
      );
    }
    const plan = planStrata({
      images: designImages,
      transects: inputs.transects,
      strata: inputs.strata,
      exclusions: area.exclusions,
    });
    const moves = new Map(plan.imageMoves.map((move) => [move.id, move]));
    // Status and transect change together, so a rerun still sees what moved.
    const imageWrites = [...statuses].flatMap(([id, { current, next }]) => {
      const change = boundaryStatusChange(current, next);
      const move = moves.get(id);
      if (change === 'skip' && !move) return [];
      const set: Record<string, unknown> = {};
      const remove: string[] = [];
      if (change === 'set') set.boundaryStatus = next;
      if (change === 'remove') remove.push('boundaryStatus');
      if (move?.to) set.transectId = move.to;
      if (move && !move.to) remove.push('transectId');
      return [
        async () => {
          const moved = await updateRow(
            tables.Image,
            id,
            set,
            remove,
            move ? { transectId: move.from } : {}
          );
          // Another writer moved the image; its status is still due.
          if (!moved && move && change !== 'skip') {
            await updateRow(
              tables.Image,
              id,
              change === 'set' ? { boundaryStatus: next } : {},
              change === 'remove' ? ['boundaryStatus'] : []
            );
          }
          counts.updated += 1;
        },
      ];
    });
    await runWrites([
      ...imageWrites,
      ...plan.transectStrata.map(({ id, stratumId }) => async () => {
        await updateRow(tables.Transect, id, { stratumId });
      }),
      ...plan.strata.map(({ id, ...stats }) => async () => {
        await updateRow(tables.Stratum, id, stats);
      }),
    ]);
    // Only after their transects have moved out.
    await runWrites(
      plan.deleteStrata.map(
        (id) => () =>
          db
            .send(new DeleteCommand({ TableName: tables.Stratum, Key: { id } }))
            .then(() => undefined)
      )
    );
    console.log('Strata reconciled', {
      projectId,
      movedImages: plan.imageMoves.length,
      movedTransects: plan.transectStrata.length,
      strata: plan.strata.length,
      deletedStrata: plan.deleteStrata.length,
    });
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
      ProjectionExpression: 'organizationId, #group',
      ExpressionAttributeNames: { '#group': 'group' },
    })
  );
  const organizationId = project.Item?.organizationId as string | undefined;
  const group = (project.Item?.group as string | undefined) ?? organizationId;
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
      () => recompute(projectId, group!, lease, remainingMs),
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
