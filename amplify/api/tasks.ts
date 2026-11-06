import { randomUUID } from 'node:crypto';
import type { Access } from './access';
import { ApiError, badRequest, forbidden, notFound } from './errors';
import type { Lease } from './leases';
import type { Models } from './models';
import type { Row } from './schema';
import type { LeaseTable, QueueMessage, TaskQueue } from './taskStore';

export interface TaskContext {
  access: Access;
  models: Models;
  queue: TaskQueue;
  leases: LeaseTable;
  neighbours(
    imageId: string,
  ): Promise<{ image1Id: string; image2Id: string }[]>;
}

// How long a task's data stays reachable after it was handed out.
const HOLD_SECONDS = 2 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const isObject = (v: unknown): v is Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

function argString(args: Row, name: string) {
  const value = str(args[name]);
  if (!value) throw badRequest(`Missing ${name}`);
  return value;
}

export async function workableQueue(ctx: TaskContext, queueId: string) {
  const queue = await ctx.models.load('Queue', { id: queueId });
  if (typeof queue?.projectId !== 'string') throw forbidden();
  const standing = await ctx.access.requireSurveyMember(queue.projectId);
  if (queue.hidden === true && standing.role !== 'admin') throw forbidden();
  return {
    queue,
    projectId: queue.projectId,
    admin: standing.role === 'admin',
  };
}

async function withNeighbours(ctx: TaskContext, imageIds: string[]) {
  const all = new Set(imageIds);
  for (const imageId of imageIds) {
    for (const n of await ctx.neighbours(imageId)) {
      all.add(n.image1Id);
      all.add(n.image2Id);
    }
  }
  return [...all];
}

async function inSurvey(
  ctx: TaskContext,
  model: string,
  id: string,
  projectId: string,
) {
  const row = await ctx.models.load(model, { id });
  if (row?.projectId !== projectId) {
    throw forbidden(`${model} ${id} is not in this survey`);
  }
  return row;
}

export async function messageScope(
  ctx: TaskContext,
  queue: Row,
  body: unknown,
) {
  const projectId = String(queue.projectId);
  if (!isObject(body)) throw badRequest('Unreadable task');
  const imageIds = new Set<string>();
  const locationIds: string[] = [];
  const pairs: string[] = [];
  let setId = str(queue.annotationSetId);
  const acceptSet = (id: unknown) => {
    const value = str(id);
    if (!value) return;
    if (setId && setId !== value)
      throw forbidden('The task names another annotation set');
    setId = value;
  };

  if (isObject(body.location) && str(body.location.id)) {
    const location = await inSurvey(
      ctx,
      'Location',
      String(body.location.id),
      projectId,
    );
    locationIds.push(String(location.id));
    if (str(location.imageId)) imageIds.add(String(location.imageId));
    acceptSet(body.location.annotationSetId);
  }
  if (isObject(body.annotation) && str(body.annotation.id)) {
    const annotation = await inSurvey(
      ctx,
      'Annotation',
      String(body.annotation.id),
      projectId,
    );
    if (str(annotation.imageId)) imageIds.add(String(annotation.imageId));
    acceptSet(annotation.setId);
  }
  if (str(body.imageId)) imageIds.add(String(body.imageId));
  const pair = [body.primaryImage, body.secondaryImage].map((i) =>
    isObject(i) ? str(i.id) : undefined,
  );
  if (pair[0] && pair[1]) {
    pair.forEach((id) => imageIds.add(id!));
    pairs.push(`${pair[0]}|${pair[1]}`);
  }
  acceptSet(body.annotationSetId);
  for (const imageId of imageIds)
    await inSurvey(ctx, 'Image', imageId, projectId);
  if (setId) await inSurvey(ctx, 'AnnotationSet', setId, projectId);
  return {
    projectId,
    imageIds: await withNeighbours(ctx, [...imageIds]),
    locationIds,
    pairs,
    setIds: setId ? [setId] : [],
  };
}

async function leaseMessage(
  ctx: TaskContext,
  queue: Row,
  url: string,
  visibility: number,
  message: QueueMessage,
) {
  const projectId = String(queue.projectId);
  let scope;
  try {
    scope = await messageScope(ctx, queue, JSON.parse(message.body));
  } catch (error) {
    if (!(error instanceof ApiError) && !(error instanceof SyntaxError)) {
      await ctx.queue.visibility(url, message.receiptHandle, 0);
      throw error;
    }
    console.warn('Dropping a task outside its queue', {
      queueId: queue.id,
      error,
    });
    await ctx.queue.remove(url, message.receiptHandle);
    return null;
  }
  const lease: Lease = {
    userId: ctx.access.userId,
    leaseId: randomUUID(),
    kind: 'queue',
    projectId,
    grantedFor: projectId,
    queueId: String(queue.id),
    queueUrl: url,
    receiptHandle: message.receiptHandle,
    imageIds: scope.imageIds,
    locationIds: scope.locationIds,
    pairs: scope.pairs,
    readSetIds: scope.setIds,
    writeSetIds: scope.setIds,
    expiresAt: now() + visibility + HOLD_SECONDS,
  };
  await ctx.leases.put(lease);
  return {
    leaseId: lease.leaseId,
    messageId: message.messageId,
    body: message.body,
  };
}

async function receiveTasks(ctx: TaskContext, args: Row, max: number) {
  const { queue } = await workableQueue(ctx, argString(args, 'queueId'));
  const url = str(queue.url);
  if (!url) throw badRequest('The queue has no URL');
  const visibility = Number(args.visibility ?? 600);
  if (!Number.isInteger(visibility) || visibility < 0 || visibility > 43_200) {
    throw badRequest('Invalid visibility');
  }
  const messages = await ctx.queue.receive(url, visibility, max);
  const tasks = await Promise.allSettled(
    messages.map((message) =>
      leaseMessage(ctx, queue, url, visibility, message),
    ),
  );
  const failed = tasks.find(
    (t): t is PromiseRejectedResult => t.status === 'rejected',
  );
  if (failed && messages.length === 1) throw failed.reason;
  if (failed) console.error('Failed to lease a received task', failed.reason);
  return tasks.flatMap((t) =>
    t.status === 'fulfilled' && t.value ? [t.value] : [],
  );
}

export async function receive(ctx: TaskContext, args: Row) {
  const [task] = await receiveTasks(ctx, args, 1);
  return { data: task ?? null };
}

// Up to SQS's batch limit, so the browser can prepare tasks ahead of the annotator.
export async function receiveBatch(ctx: TaskContext, args: Row) {
  const max = Number(args.max ?? 1);
  if (!Number.isInteger(max) || max < 1 || max > 10)
    throw badRequest('Invalid max');
  return { data: await receiveTasks(ctx, args, max) };
}

async function heldQueueLease(ctx: TaskContext, args: Row) {
  const lease = await ctx.leases.get(
    ctx.access.userId,
    argString(args, 'leaseId'),
  );
  if (
    !lease ||
    lease.kind !== 'queue' ||
    !lease.queueUrl ||
    !lease.receiptHandle ||
    lease.expiresAt <= now()
  ) {
    throw notFound('No such task');
  }
  await ctx.access.requireSurveyMember(lease.grantedFor);
  return lease as Lease & { queueUrl: string; receiptHandle: string };
}

export async function ack(ctx: TaskContext, args: Row) {
  const lease = await heldQueueLease(ctx, args);
  await ctx.queue.remove(lease.queueUrl, lease.receiptHandle);
  return { data: true };
}

export async function visibility(ctx: TaskContext, args: Row) {
  const lease = await heldQueueLease(ctx, args);
  const seconds = Number(args.seconds);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 43_200) {
    throw badRequest('Invalid seconds');
  }
  await ctx.queue.visibility(lease.queueUrl, lease.receiptHandle, seconds);
  const expiresAt =
    seconds === 0
      ? now()
      : Math.max(lease.expiresAt, now() + seconds + HOLD_SECONDS);
  await ctx.leases.expire(lease.userId, lease.leaseId, expiresAt);
  return { data: true };
}

export async function depth(ctx: TaskContext, args: Row) {
  const ids = args.queueIds;
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every((id) => str(id))) {
    throw badRequest('Invalid queueIds');
  }
  const counts: Record<string, string> = {};
  for (const id of ids as string[]) {
    try {
      const { queue } = await workableQueue(ctx, id);
      counts[id] = str(queue.url)
        ? await ctx.queue.depth(String(queue.url))
        : 'Unknown';
    } catch {
      counts[id] = 'Unknown';
    }
  }
  return { data: counts };
}

export async function test(ctx: TaskContext, args: Row) {
  const projectId = argString(args, 'projectId');
  const testPresetId = argString(args, 'testPresetId');
  const locationId = argString(args, 'locationId');
  const annotationSetId = argString(args, 'annotationSetId');
  await ctx.access.requireSurveyMember(projectId);
  const [link, entry] = await Promise.all([
    ctx.models.load('TestPresetProject', { testPresetId, projectId }),
    ctx.models.load('TestPresetLocation', {
      testPresetId,
      locationId,
      annotationSetId,
    }),
  ]);
  if (!link || !entry) throw forbidden('Not a test of this survey');
  const location = await ctx.models.load('Location', { id: locationId });
  if (!location || !str(location.imageId))
    throw notFound('Test location not found');
  const lease: Lease = {
    userId: ctx.access.userId,
    leaseId: randomUUID(),
    kind: 'test',
    projectId: String(location.projectId),
    grantedFor: projectId,
    imageIds: await withNeighbours(ctx, [String(location.imageId)]),
    locationIds: [locationId],
    pairs: [],
    readSetIds: [annotationSetId],
    writeSetIds: [],
    expiresAt: now() + HOLD_SECONDS,
  };
  await ctx.leases.put(lease);
  return { data: { leaseId: lease.leaseId } };
}

export async function holdJob(ctx: TaskContext, jobId: string) {
  const job = await ctx.models.load('IndividualIdJob', { id: jobId });
  if (
    !job ||
    job.status !== 'active' ||
    !str(job.projectId) ||
    !str(job.annotationSetId)
  )
    return;
  await ctx.access.requireSurveyMember(String(job.projectId));
  await ctx.leases.put({
    userId: ctx.access.userId,
    leaseId: `job-${jobId}`,
    kind: 'job',
    projectId: String(job.projectId),
    grantedFor: String(job.projectId),
    imageIds: [],
    locationIds: [],
    pairs: [],
    readSetIds: [String(job.annotationSetId)],
    writeSetIds: [String(job.annotationSetId)],
    wholeSurvey: true,
    expiresAt: now() + HOLD_SECONDS,
  });
}

export async function assignedTransect(
  ctx: TaskContext,
  transectRowId: string,
) {
  const transect = await ctx.models.load('IndividualIdTransect', {
    id: transectRowId,
  });
  if (
    !transect ||
    transect.status !== 'assigned' ||
    !ctx.access.isSelf(transect.assignedUserId)
  ) {
    throw forbidden();
  }
  await ctx.access.requireSurveyMember(String(transect.projectId));
  return transect;
}
