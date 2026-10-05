import { createHash } from 'node:crypto';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import pLimit from 'p-limit';
import {
  INFO_TAG_LEASE_MS,
  MAX_INFO_TAGS_PER_ANNOTATION,
  type InfoTagRequest,
  type InfoTagResponse,
  type InfoTagSnapshot,
} from '../../../shared/infoTagProtocol';
import {
  authorizeProject,
  requireStorageUser,
  type ProjectRow,
} from '../../storage/shared/identity';
import {
  isTransactionConflict,
  transactionConflictDelayMs,
} from '../updateUserStats/core';

export type InfoTagTables = {
  work: string;
  Queue: string;
  Project: string;
  AnnotationSet: string;
  Image: string;
  Annotation: string;
  InfoTag: string;
  AnnotationInfoTag: string;
};
export type Manifest = {
  annotationSetId: string;
  categoryIds: string[];
  items: Array<{ imageId: string; annotationIds: string[] }>;
};
type Row = Record<string, unknown>;
type QueueRow = {
  id: string;
  projectId: string;
  annotationSetId: string;
  tag: string;
  group: string;
  locationManifestS3Key?: string;
  infoTagProtocolVersion?: number;
};
type LeaseRow = {
  userId: string;
  sessionId: string;
  generation: number;
  expiresAt: number;
};
type AnnotationRow = Omit<InfoTagSnapshot, 'tagIds'>;
type Task = {
  annotationIds: string[];
  categoryIds: string[];
  completedAt?: string;
};
// Receipts confirm lost-response retries for at least 30 days. Once a receipt
// is deleted, the lease and annotation revision still prevent reapplying a save.
// Keep lease generations, task targets/completions and touched markers durable.
const SAVE_RECEIPT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const conditionalFailure = (error: unknown) =>
  (error as Error)?.name === 'ConditionalCheckFailedException';

function identifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new Error(`Invalid ${name}`);
}

// Rollout requires the backend first, then a client reload before Info Tags work
// resumes. Legacy clients can still mutate the models directly; those writes do
// not take part in the claim/revision protocol or its completion deduplication.
export function createInfoTagWorkService(options: {
  db: DynamoDBDocumentClient;
  tables: InfoTagTables;
  readManifest: (key: string) => Promise<Manifest>;
  now?: () => number;
}) {
  const { db, tables, readManifest } = options;
  const now = options.now ?? Date.now;
  const get = async <T = Row>(
    TableName: string,
    Key: Row
  ): Promise<T | undefined> =>
    (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true })))
      .Item as T | undefined;

  return async (
    identity: unknown,
    request: InfoTagRequest
  ): Promise<InfoTagResponse> => {
    const user = requireStorageUser(identity);
    if (
      !request ||
      !['claim', 'renew', 'release', 'save', 'complete'].includes(
        request.action
      )
    ) {
      throw new Error('Invalid Info Tags action');
    }
    for (const name of ['queueId', 'imageId', 'sessionId'] as const)
      identifier(request[name], name);
    const foundQueue = await get<QueueRow>(tables.Queue, {
      id: request.queueId,
    });
    if (!foundQueue || foundQueue.tag !== 'info-tags')
      throw new Error('Info Tags queue unavailable');
    const queue = foundQueue;
    const foundProject = await get<ProjectRow>(tables.Project, {
      id: queue.projectId,
    });
    authorizeProject(user, foundProject);
    const project = foundProject;
    const [set, image] = await Promise.all([
      get<{ projectId: string }>(tables.AnnotationSet, {
        id: queue.annotationSetId,
      }),
      get<{ projectId: string }>(tables.Image, { id: request.imageId }),
    ]);
    if (
      set?.projectId !== project.id ||
      image?.projectId !== project.id ||
      queue.group !== project.organizationId
    ) {
      throw new Error('Image or annotation set does not belong to this queue');
    }
    const pk = JSON.stringify([queue.annotationSetId, request.imageId]);
    const leaseKey = { pk, sk: 'lease' };
    const taskKey = { pk, sk: `task#${request.queueId}` };
    const timestamp = () => new Date(now()).toISOString();

    function leaseCondition() {
      if (!Number.isSafeInteger(request.generation) || request.generation! < 1)
        throw new Error('Invalid claim generation');
      return {
        ConditionExpression:
          'userId = :user AND sessionId = :session ' +
          'AND generation = :generation AND expiresAt > :now',
        ExpressionAttributeValues: {
          ':user': user.sub,
          ':session': request.sessionId,
          ':generation': request.generation,
          ':now': now(),
        },
      };
    }

    async function checkLease() {
      const lease = await get<LeaseRow>(tables.work, leaseKey);
      if (
        !lease ||
        lease.userId !== user.sub ||
        lease.sessionId !== request.sessionId ||
        lease.generation !== request.generation ||
        lease.expiresAt <= now()
      ) {
        throw new Error(
          'CLAIM_LOST: This image is no longer reserved by this session. Reload before editing.'
        );
      }
      return lease;
    }

    async function transaction(build: () => TransactWriteCommandInput) {
      for (let attempt = 0; ; attempt++) {
        try {
          await db.send(new TransactWriteCommand(build()));
          return;
        } catch (error) {
          if (isTransactionConflict(error) && attempt < 4) {
            await sleep(transactionConflictDelayMs(attempt));
            continue;
          }
          throw error;
        }
      }
    }

    // Persist immutable targets once. This also supports queues launched before
    // the claim protocol was deployed, using their existing S3 manifest.
    async function task(): Promise<Task> {
      const existing = await get<Task>(tables.work, taskKey);
      if (existing) return existing as Task;
      if (typeof queue.locationManifestS3Key !== 'string')
        throw new Error('Queue manifest unavailable');
      const manifest = await readManifest(queue.locationManifestS3Key);
      if (
        manifest.annotationSetId !== queue.annotationSetId ||
        !Array.isArray(manifest.categoryIds)
      ) {
        throw new Error('Queue manifest does not match its annotation set');
      }
      const item = manifest.items.find(
        (row) => row.imageId === request.imageId
      );
      if (!item || !Array.isArray(item.annotationIds))
        throw new Error('Image is not part of this queue');
      item.annotationIds.forEach((id) =>
        identifier(id, 'manifest annotation ID')
      );
      const value = {
        ...taskKey,
        annotationIds: [...new Set(item.annotationIds)],
        categoryIds: manifest.categoryIds,
        createdAt: timestamp(),
      };
      if (Buffer.byteLength(JSON.stringify(value)) > 350_000)
        throw new Error('Image work manifest exceeds the supported size');
      try {
        await db.send(
          new PutCommand({
            TableName: tables.work,
            Item: value,
            ConditionExpression: 'attribute_not_exists(pk)',
          })
        );
        return value;
      } catch (error) {
        if (!conditionalFailure(error)) throw error;
        return (await get<Task>(tables.work, taskKey)) as Task;
      }
    }

    async function annotations(
      work: Task,
      withTags: boolean
    ): Promise<InfoTagSnapshot[]> {
      const limit = pLimit(20);
      const rows = await Promise.all(
        work.annotationIds.map((id) =>
          limit(async () => {
            const row = await get<AnnotationRow>(tables.Annotation, { id });
            // Deletion or relabelling removes a target from the remaining work.
            if (!row) return null;
            if (
              row.projectId !== project.id ||
              row.setId !== queue.annotationSetId ||
              row.imageId !== request.imageId
            ) {
              throw new Error('Annotation does not belong to the queued image');
            }
            if (!work.categoryIds.includes(row.categoryId)) return null;
            return {
              id,
              imageId: row.imageId,
              setId: row.setId,
              projectId: row.projectId,
              categoryId: row.categoryId,
              group: row.group ?? null,
              x: row.x,
              y: row.y,
              infoTaggedBy: row.infoTaggedBy ?? null,
              infoTagRevision: row.infoTagRevision ?? 0,
              tagIds: withTags ? await tagIds(id) : [],
            };
          })
        )
      );
      return rows.filter((row): row is InfoTagSnapshot => row !== null);
    }

    async function tagIds(annotationId: string): Promise<string[]> {
      const ids: string[] = [];
      let cursor: Row | undefined;
      do {
        const page = await db.send(
          new QueryCommand({
            TableName: tables.AnnotationInfoTag,
            ConsistentRead: true,
            KeyConditionExpression: 'annotationId = :id',
            ExpressionAttributeValues: { ':id': annotationId },
            ExclusiveStartKey: cursor,
          })
        );
        for (const row of page.Items ?? []) ids.push(row.infoTagId);
        cursor = page.LastEvaluatedKey;
      } while (cursor);
      return ids.sort();
    }

    if (request.action === 'claim') {
      const work = await task();
      if (work.completedAt && !request.edit) return { status: 'completed' };
      // Repeating a claim whose response was lost preserves its generation.
      const existing = await get<LeaseRow>(tables.work, leaseKey);
      let lease: LeaseRow;
      if (
        existing?.userId === user.sub &&
        existing.sessionId === request.sessionId &&
        existing.expiresAt > now()
      ) {
        request.generation = existing.generation;
        lease = (
          await db.send(
            new UpdateCommand({
              TableName: tables.work,
              Key: leaseKey,
              ...leaseCondition(),
              UpdateExpression: 'SET expiresAt = :expiry',
              ExpressionAttributeValues: {
                ...leaseCondition().ExpressionAttributeValues,
                ':expiry': now() + INFO_TAG_LEASE_MS,
              },
              ReturnValues: 'ALL_NEW',
            })
          )
        ).Attributes as LeaseRow;
      } else {
        try {
          lease = (
            await db.send(
              new UpdateCommand({
                TableName: tables.work,
                Key: leaseKey,
                ConditionExpression:
                  'attribute_not_exists(expiresAt) OR expiresAt <= :now',
                UpdateExpression:
                  'SET userId = :user, sessionId = :session, expiresAt = :expiry, ' +
                  'generation = if_not_exists(generation, :zero) + :one',
                ExpressionAttributeValues: {
                  ':now': now(),
                  ':expiry': now() + INFO_TAG_LEASE_MS,
                  ':user': user.sub,
                  ':session': request.sessionId,
                  ':zero': 0,
                  ':one': 1,
                },
                ReturnValues: 'ALL_NEW',
              })
            )
          ).Attributes as LeaseRow;
        } catch (error) {
          if (conditionalFailure(error)) return { status: 'busy' };
          throw error;
        }
      }
      request.generation = lease.generation;
      const rows = await annotations(work, true);
      // Do not return an editable snapshot if loading outlived the lease.
      await checkLease();
      return {
        status: 'claimed',
        lease: {
          sessionId: request.sessionId,
          generation: lease.generation,
          expiresAt: lease.expiresAt,
        },
        annotations: rows,
        targetIds: rows
          .filter((row) => request.edit || !row.infoTaggedBy)
          .map((row) => row.id),
      };
    }

    if (request.action === 'renew' || request.action === 'release') {
      const expiresAt =
        request.action === 'release' ? 0 : now() + INFO_TAG_LEASE_MS;
      try {
        await db.send(
          new UpdateCommand({
            TableName: tables.work,
            Key: leaseKey,
            ...leaseCondition(),
            UpdateExpression: 'SET expiresAt = :expiry',
            ExpressionAttributeValues: {
              ...leaseCondition().ExpressionAttributeValues,
              ':expiry': expiresAt,
            },
          })
        );
      } catch (error) {
        if (request.action === 'release' && conditionalFailure(error))
          return { status: 'released' };
        if (conditionalFailure(error))
          throw new Error(
            'CLAIM_LOST: This image reservation expired or changed owners.'
          );
        throw error;
      }
      return {
        status: request.action === 'release' ? 'released' : 'claimed',
        lease: {
          sessionId: request.sessionId,
          generation: request.generation!,
          expiresAt,
        },
      };
    }

    const work = await task();
    if (request.action === 'complete') {
      if (work.completedAt) {
        // A revisit can edit completed work but must release its new claim too.
        try {
          await db.send(
            new UpdateCommand({
              TableName: tables.work,
              Key: leaseKey,
              ...leaseCondition(),
              UpdateExpression: 'SET expiresAt = :expired',
              ExpressionAttributeValues: {
                ...leaseCondition().ExpressionAttributeValues,
                ':expired': 0,
              },
            })
          );
        } catch (error) {
          if (!conditionalFailure(error)) throw error;
        }
        return { status: 'completed' };
      }
      try {
        await checkLease();
        const rows = await annotations(work, false);
        if (rows.some((row) => !row.infoTaggedBy))
          throw new Error('This image still has unfinished annotations');
        // Legacy queues may already have credited the image before rollout. Only
        // count legacy work if this protocol actually saved an annotation in it.
        const touched = await get(tables.work, {
          pk,
          sk: `touched#${request.queueId}`,
        });
        const count = queue.infoTagProtocolVersion === 1 || Boolean(touched);
        await transaction(() => ({
          TransactItems: [
            {
              Update: {
                TableName: tables.work,
                Key: leaseKey,
                ...leaseCondition(),
                UpdateExpression: 'SET expiresAt = :expired',
                ExpressionAttributeValues: {
                  ...leaseCondition().ExpressionAttributeValues,
                  ':expired': 0,
                },
              },
            },
            {
              Update: {
                TableName: tables.work,
                Key: taskKey,
                UpdateExpression: 'SET completedAt = :time',
                ConditionExpression: 'attribute_not_exists(completedAt)',
                ExpressionAttributeValues: { ':time': timestamp() },
              },
            },
            ...(count
              ? [
                  {
                    Update: {
                      TableName: tables.Queue,
                      Key: { id: request.queueId },
                      UpdateExpression:
                        'SET lastObservationAt = :time ADD observedCount :one',
                      ConditionExpression: 'attribute_exists(id)',
                      ExpressionAttributeValues: {
                        ':time': timestamp(),
                        ':one': 1,
                      },
                    },
                  },
                ]
              : []),
          ],
        }));
      } catch (error) {
        if ((await get<Task>(tables.work, taskKey))?.completedAt)
          return { status: 'completed' };
        await checkLease();
        throw error;
      }
      return { status: 'completed' };
    }

    identifier(request.annotationId, 'annotationId');
    identifier(request.operationId, 'operationId');
    if (!work.annotationIds.includes(request.annotationId))
      throw new Error('Annotation is not part of this image task');
    if (
      !Number.isSafeInteger(request.expectedRevision) ||
      request.expectedRevision! < 0 ||
      !Number.isSafeInteger(request.x) ||
      !Number.isSafeInteger(request.y)
    )
      throw new Error('Invalid annotation revision or coordinates');
    if (
      !Array.isArray(request.tagIds) ||
      request.tagIds.length > MAX_INFO_TAGS_PER_ANNOTATION
    ) {
      throw new Error(
        `Choose at most ${MAX_INFO_TAGS_PER_ANNOTATION} tags per annotation`
      );
    }
    request.tagIds.forEach((id) => identifier(id, 'tagId'));
    const after = [...new Set(request.tagIds)].sort();
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          userId: user.sub,
          queueId: request.queueId,
          sessionId: request.sessionId,
          generation: request.generation,
          annotationId: request.annotationId,
          revision: request.expectedRevision,
          tagIds: after,
          x: request.x,
          y: request.y,
        })
      )
      .digest('hex');
    const receiptKey = { pk, sk: `save#${request.operationId}` };
    const receipt = async () => {
      const row = await get<{ digest: string; revision: number }>(
        tables.work,
        receiptKey
      );
      if (!row) return undefined;
      if (row.digest !== digest)
        throw new Error(
          'Save operation ID was already used for different changes'
        );
      return { status: 'saved' as const, revision: row.revision as number };
    };
    const previous = await receipt();
    if (previous) return previous;
    await checkLease();
    const annotation = await get<AnnotationRow>(tables.Annotation, {
      id: request.annotationId,
    });
    if (
      !annotation ||
      annotation.projectId !== project.id ||
      annotation.imageId !== request.imageId ||
      annotation.setId !== queue.annotationSetId ||
      !work.categoryIds.includes(annotation.categoryId)
    ) {
      throw new Error('Annotation is no longer eligible for this task');
    }
    if ((annotation.infoTagRevision ?? 0) !== request.expectedRevision) {
      throw new Error(
        'REVISION_CONFLICT: This annotation changed. Reload before editing.'
      );
    }
    await Promise.all(
      after.map(async (id) => {
        const tag = await get<{ projectId: string; annotationSetId: string }>(
          tables.InfoTag,
          { id }
        );
        if (
          tag?.projectId !== project.id ||
          tag?.annotationSetId !== queue.annotationSetId
        ) {
          throw new Error('Tag does not belong to this annotation set');
        }
      })
    );
    const before = await tagIds(request.annotationId);
    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));
    if (added.length + removed.length + 4 > 100)
      throw new Error('Too many tag changes for one save');
    const revision = request.expectedRevision! + 1;
    const time = timestamp();
    try {
      await transaction(() => ({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: tables.work,
              Key: leaseKey,
              ...leaseCondition(),
            },
          },
          {
            Update: {
              TableName: tables.Annotation,
              Key: { id: request.annotationId },
              UpdateExpression:
                'SET infoTaggedBy = :user, infoTagRevision = :next, ' +
                'x = :x, y = :y, updatedAt = :time',
              ConditionExpression:
                'attribute_exists(id) AND setId = :set AND imageId = :image ' +
                'AND categoryId = :category AND (infoTagRevision = :revision OR ' +
                '((attribute_not_exists(infoTagRevision) OR ' +
                'attribute_type(infoTagRevision, :nullType)) AND :revision = :zero))',
              ExpressionAttributeValues: {
                ':user': user.sub,
                ':next': revision,
                ':x': request.x,
                ':y': request.y,
                ':time': time,
                ':revision': request.expectedRevision,
                ':zero': 0,
                ':nullType': 'NULL',
                ':set': queue.annotationSetId,
                ':image': request.imageId,
                ':category': annotation.categoryId,
              },
            },
          },
          {
            Put: {
              TableName: tables.work,
              Item: {
                ...receiptKey,
                digest,
                revision,
                createdAt: time,
                deleteAfter:
                  Math.floor(now() / 1000) + SAVE_RECEIPT_RETENTION_SECONDS,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Put: {
              TableName: tables.work,
              Item: { pk, sk: `touched#${request.queueId}` },
            },
          },
          ...added.map((infoTagId) => ({
            Put: {
              TableName: tables.AnnotationInfoTag,
              Item: {
                annotationId: request.annotationId,
                infoTagId,
                annotationSetId: queue.annotationSetId,
                projectId: project.id,
                group: project.organizationId,
                createdAt: time,
                updatedAt: time,
                __typename: 'AnnotationInfoTag',
              },
            },
          })),
          ...removed.map((infoTagId) => ({
            Delete: {
              TableName: tables.AnnotationInfoTag,
              Key: { annotationId: request.annotationId, infoTagId },
            },
          })),
        ],
      }));
    } catch (error) {
      const saved = await receipt();
      if (saved) return saved;
      await checkLease();
      const current = await get<AnnotationRow>(tables.Annotation, {
        id: request.annotationId,
      });
      if (
        !current ||
        (current.infoTagRevision ?? 0) !== request.expectedRevision
      ) {
        throw new Error(
          'REVISION_CONFLICT: This annotation changed. Reload before editing.'
        );
      }
      throw error;
    }
    return { status: 'saved', revision };
  };
}
