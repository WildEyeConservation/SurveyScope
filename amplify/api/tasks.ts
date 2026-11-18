import { randomUUID } from 'node:crypto';
import { isWithinLocationBounds } from '../../shared/locationGeometry';
import type { TestKeyCount } from '../../shared/testScoring';
import {
  growTestBox,
  tileSizeForImage,
  type Box,
  type Size,
} from '../../shared/testTileBounds';
import type { Access } from './access';
import { ApiError, badRequest, forbidden, notFound } from './errors';
import type { Lease } from './leases';
import type { DataLayer, Models } from './models';
import type { Row } from './schema';
import type { LeaseTable, QueueMessage, TaskQueue } from './taskStore';

export interface TaskContext {
  access: Access;
  models: Models;
  // Unchecked reads and writes, for answers the caller may not see.
  data: DataLayer;
  queue: TaskQueue;
  leases: LeaseTable;
  neighbours(
    imageId: string,
  ): Promise<{ image1Id: string; image2Id: string }[]>;
}

// How long test and job data stays reachable after it was handed out.
const HOLD_SECONDS = 2 * 3600;
// A queue task stays open a while past its visibility timeout, and an hour after it is done.
const UNACKED_GRACE_SECONDS = 1800;
const ACKED_HOLD_SECONDS = 3600;
const MAX_VISIBILITY_SECONDS = 3600;
const MIN_RECEIVE_VISIBILITY_SECONDS = 60;
const MAX_HELD_TASKS = 30;
const MISSING_ROW_RETRIES = 5;
const MISSING_ROW_DELAY_SECONDS = 60;
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
  if (!row) throw notFound(`${model} ${id} was not found`);
  if (row.projectId !== projectId) {
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
    // A row written moments ago may not be readable yet.
    if (
      error instanceof ApiError &&
      error.status === 404 &&
      message.receiveCount < MISSING_ROW_RETRIES
    ) {
      await ctx.queue.visibility(
        url,
        message.receiptHandle,
        MISSING_ROW_DELAY_SECONDS,
      );
      return null;
    }
    console.warn('Dropping a task outside its queue', {
      queueId: queue.id,
      error,
    });
    await ctx.queue.remove(url, message.receiptHandle);
    return null;
  }
  // Someone saved it but the acknowledgement was lost.
  if (
    scope.locationIds.length &&
    (await ctx.models.load('Observation', {
      id: `queue-message:${message.messageId}`,
    }))
  ) {
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
    messageId: message.messageId,
    imageIds: scope.imageIds,
    locationIds: scope.locationIds,
    pairs: scope.pairs,
    readSetIds: scope.setIds,
    writeSetIds: scope.setIds,
    expiresAt: now() + visibility + UNACKED_GRACE_SECONDS,
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
  if (
    !Number.isInteger(visibility) ||
    visibility < MIN_RECEIVE_VISIBILITY_SECONDS ||
    visibility > MAX_VISIBILITY_SECONDS
  ) {
    throw badRequest('Invalid visibility');
  }
  // Counting and leasing must not interleave with another receive.
  const lock = `queue#${String(queue.id)}`;
  if (!(await ctx.leases.lock(ctx.access.userId, lock, 30))) return [];
  try {
    const held = (await ctx.leases.active(ctx.access.userId)).filter(
      (l) => l.kind === 'queue' && l.queueId === queue.id && !l.acked,
    ).length;
    if (held >= MAX_HELD_TASKS) {
      throw new ApiError(
        429,
        'TooManyTasks',
        'Finish or release some tasks from this queue first',
      );
    }
    const messages = await ctx.queue.receive(
      url,
      visibility,
      Math.min(max, MAX_HELD_TASKS - held),
    );
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
  } finally {
    await ctx.leases.unlock(ctx.access.userId, lock);
  }
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
  await ctx.leases.expire(
    lease.userId,
    lease.leaseId,
    now() + ACKED_HOLD_SECONDS,
    true,
  );
  return { data: true };
}

export async function visibility(ctx: TaskContext, args: Row) {
  const lease = await heldQueueLease(ctx, args);
  const seconds = Number(args.seconds);
  if (
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > MAX_VISIBILITY_SECONDS
  ) {
    throw badRequest('Invalid seconds');
  }
  await ctx.queue.visibility(lease.queueUrl, lease.receiptHandle, seconds);
  const expiresAt =
    seconds === 0
      ? now()
      : Math.max(lease.expiresAt, now() + seconds + UNACKED_GRACE_SECONDS);
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

async function queryAll(
  ctx: TaskContext,
  model: string,
  field: string,
  input: Row,
): Promise<Row[]> {
  const rows: Row[] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await ctx.data.query(model, field, input, {
      limit: 1000,
      nextToken,
    });
    if (page.errors?.length && !page.data)
      throw new Error(
        `Could not read ${model}: ${JSON.stringify(page.errors)}`,
      );
    rows.push(...(page.data ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return rows;
}

const categoryNames = async (ctx: TaskContext, annotationSetId: string) =>
  new Map(
    (
      await queryAll(ctx, 'Category', 'categoriesByAnnotationSetId', {
        annotationSetId,
      })
    ).map((c) => [String(c.id), String(c.name ?? '')]),
  );

function sizeArg(value: unknown): Size | undefined {
  if (
    !isObject(value) ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number' ||
    !(value.width > 0) ||
    !(value.height > 0)
  )
    return undefined;
  return { width: value.width, height: value.height };
}

// Every test is graded in its location's own box, however it is served.
async function testKey(
  ctx: TaskContext,
  test: NonNullable<Lease['test']>,
): Promise<TestKeyCount[]> {
  const [names, counts] = await Promise.all([
    categoryNames(ctx, test.annotationSetId),
    queryAll(
      ctx,
      'LocationAnnotationCount',
      'categoryCountsByLocationIdAndAnnotationSetId',
      {
        locationId: test.locationId,
        annotationSetId: { eq: test.annotationSetId },
      },
    ),
  ]);
  return counts
    .filter((c) => c.annotationSetId === test.annotationSetId)
    .map((c) => ({
      categoryId: String(c.categoryId),
      category: { name: names.get(String(c.categoryId)) ?? '' },
      count: Number(c.count ?? 0),
    }));
}

export async function test(ctx: TaskContext, args: Row) {
  const projectId = argString(args, 'projectId');
  const testPresetId = argString(args, 'testPresetId');
  const locationId = argString(args, 'locationId');
  const annotationSetId = argString(args, 'annotationSetId');
  const jobSetId = argString(args, 'jobAnnotationSetId');
  await ctx.access.requireSurveyMember(projectId);
  const [link, entry, jobSet] = await Promise.all([
    ctx.models.load('TestPresetProject', { testPresetId, projectId }),
    ctx.models.load('TestPresetLocation', {
      testPresetId,
      locationId,
      annotationSetId,
    }),
    ctx.models.load('AnnotationSet', { id: jobSetId }),
  ]);
  if (!link || !entry) throw forbidden('Not a test of this survey');
  if (jobSet?.projectId !== projectId)
    throw forbidden('The job set is not in this survey');
  const location = await ctx.models.load('Location', { id: locationId });
  if (!location || !str(location.imageId))
    throw notFound('Test location not found');
  const imageId = String(location.imageId);
  const image = await ctx.models.load('Image', { id: imageId });
  const imageSize = sizeArg(image);
  const tile = isObject(args.tile)
    ? { tile: sizeArg(args.tile.tile), image: sizeArg(args.tile.image) }
    : undefined;
  if (tile && (!tile.tile || !tile.image || !imageSize))
    throw badRequest('Invalid tile');

  // An open lease is reused, so a location keeps one box per job.
  const reused = (await ctx.leases.active(ctx.access.userId)).find(
    (l) =>
      l.kind === 'test' &&
      l.grantedFor === projectId &&
      l.test?.locationId === locationId &&
      l.test.annotationSetId === annotationSetId &&
      l.test.testPresetId === testPresetId &&
      l.test.jobSetId === jobSetId &&
      !l.test.submitted,
  );
  let box: Box;
  let grown = false;
  const answerBox: Box = {
    x: Number(location.x),
    y: Number(location.y),
    width: Number(location.width),
    height: Number(location.height),
  };
  if (reused?.test) {
    box = reused.test.box;
    grown = reused.test.grown;
  } else {
    box = answerBox;
    if (tile) {
      const sample = { tile: tile.tile!, image: tile.image! };
      const fitted = growTestBox(
        box,
        tileSizeForImage(sample, imageSize!),
        imageSize!,
        locationId,
      );
      if (!fitted) return { data: null };
      grown = true;
      box = fitted;
    }
  }

  const test = {
    testPresetId,
    annotationSetId,
    jobSetId,
    locationId,
    imageId,
    box,
    answerBox,
    grown,
  };
  const [key, jobNames] = await Promise.all([
    testKey(ctx, test),
    categoryNames(ctx, jobSetId),
  ]);
  const labels = new Set([...jobNames.values()].map((n) => n.toLowerCase()));
  // A tester cannot answer with labels their job lacks.
  if (key.some((k) => !labels.has(k.category.name.toLowerCase())))
    return { data: null };

  const lease: Lease = reused ?? {
    userId: ctx.access.userId,
    leaseId: randomUUID(),
    kind: 'test',
    projectId: String(location.projectId),
    grantedFor: projectId,
    imageIds: await withNeighbours(ctx, [imageId]),
    locationIds: [locationId],
    pairs: [],
    readSetIds: [],
    writeSetIds: [],
    test,
    expiresAt: now() + HOLD_SECONDS,
  };
  if (!reused) await ctx.leases.put(lease);

  // Answers are only ever inside test boxes, so those are all that is hidden.
  const [referenceNames, pool, onImage, annotations] = await Promise.all([
    categoryNames(ctx, annotationSetId),
    ctx.access.testPool(),
    queryAll(ctx, 'Location', 'locationsByImageKey', { imageId }),
    queryAll(ctx, 'Annotation', 'annotationsByImageIdAndSetId', {
      imageId,
      setId: { eq: annotationSetId },
    }),
  ]);
  const hidden: Box[] = [
    answerBox,
    ...onImage
      .filter(
        (other) =>
          other.imageId === imageId &&
          pool.locations.has(`${other.id}|${annotationSetId}`),
      )
      .map((other) => ({
        x: Number(other.x),
        y: Number(other.y),
        width: Number(other.width),
        height: Number(other.height),
      })),
  ];
  const context = annotations
    .filter(
      (a) =>
        a.setId === annotationSetId &&
        !hidden.some((b) =>
          isWithinLocationBounds({ x: Number(a.x), y: Number(a.y) }, b),
        ),
    )
    .map((a) => ({
      id: String(a.id),
      x: Number(a.x),
      y: Number(a.y),
      source: a.source ?? null,
      categoryName: referenceNames.get(String(a.categoryId)) ?? '',
    }));
  return {
    data: {
      leaseId: lease.leaseId,
      location: {
        id: locationId,
        x: location.x,
        y: location.y,
        width: location.width,
        height: location.height,
        image: imageSize,
      },
      box,
      grown,
      context,
    },
  };
}

const MAX_TEST_MARKS = 2000;

async function gradeTest(
  ctx: TaskContext,
  test: NonNullable<Lease['test']>,
  marks: unknown,
): Promise<NonNullable<NonNullable<Lease['test']>['grade']>> {
  if (
    !Array.isArray(marks) ||
    marks.length > MAX_TEST_MARKS ||
    !marks.every(
      (m) =>
        isObject(m) &&
        typeof m.x === 'number' &&
        typeof m.y === 'number' &&
        typeof m.categoryId === 'string',
    )
  )
    throw badRequest('Invalid annotations');
  const [key, jobNames] = await Promise.all([
    testKey(ctx, test),
    categoryNames(ctx, test.jobSetId),
  ]);
  const userCounts: Record<string, number> = {};
  for (const mark of marks as { x: number; y: number; categoryId: string }[]) {
    const name = jobNames.get(mark.categoryId)?.toLowerCase();
    if (name === undefined || !isWithinLocationBounds(mark, test.answerBox))
      continue;
    userCounts[name] = (userCounts[name] ?? 0) + 1;
  }
  const userTotal = Object.values(userCounts).reduce((a, b) => a + b, 0);
  const testAnimals = key.reduce((a, k) => a + k.count, 0);
  const labels = new Set([...jobNames.values()].map((n) => n.toLowerCase()));
  return {
    testAnimals,
    totalMissedAnimals: testAnimals - userTotal,
    counts: key
      .filter((k) => labels.has(k.category.name.toLowerCase()))
      .map((k) => ({
        categoryName: k.category.name,
        userCount: userCounts[k.category.name.toLowerCase()] ?? 0,
        testCount: k.count,
      })),
  };
}

async function upsert(ctx: TaskContext, model: string, key: Row, row: Row) {
  const existing = await ctx.data.get(model, key, {});
  const written = existing.data
    ? await ctx.data.update(model, { ...key, ...row }, {})
    : await ctx.data.create(model, { ...key, ...row }, {});
  if (!written.data)
    throw new Error(
      `Could not save ${model}: ${JSON.stringify(written.errors)}`,
    );
}

// The first submission stands.
export async function submitTest(ctx: TaskContext, args: Row) {
  const lease = await ctx.leases.get(
    ctx.access.userId,
    argString(args, 'leaseId'),
  );
  if (!lease?.test || lease.kind !== 'test' || lease.expiresAt <= now())
    throw notFound('No such test');
  await ctx.access.requireSurveyMember(lease.grantedFor);
  if (lease.test.submitted) return { data: { testResultId: lease.leaseId } };
  let current = lease;
  if (!lease.test.grade) {
    await ctx.leases.fixGrade(
      lease.userId,
      lease.leaseId,
      await gradeTest(ctx, lease.test, args.annotations),
    );
    // A concurrent submission may have fixed its grade first; that one stands.
    current = (await ctx.leases.get(lease.userId, lease.leaseId)) ?? lease;
  }
  const test = current.test!;
  const grade = test.grade;
  if (!grade) throw new Error('The test grade was not saved');

  const group =
    (await ctx.access.organizationOfProject(lease.grantedFor)) ?? undefined;
  await upsert(
    ctx,
    'TestResult',
    { id: lease.leaseId },
    {
      userId: ctx.access.userId,
      projectId: lease.grantedFor,
      testPresetId: test.testPresetId,
      locationId: test.locationId,
      annotationSetId: test.annotationSetId,
      testAnimals: grade.testAnimals,
      totalMissedAnimals: grade.totalMissedAnimals,
      passedOnTotal: false,
      labelsLinked: true,
      group,
    },
  );
  await Promise.all(
    grade.counts.map((c) =>
      upsert(
        ctx,
        'TestResultCategoryCount',
        { testResultId: lease.leaseId, categoryName: c.categoryName },
        { userCount: c.userCount, testCount: c.testCount, group },
      ),
    ),
  );
  await ctx.leases.put({ ...current, test: { ...test, submitted: true } });
  return { data: { testResultId: lease.leaseId } };
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
