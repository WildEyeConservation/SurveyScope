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

// Only neighbours in the same survey join a lease, whatever an edge says.
async function withNeighbours(
  ctx: TaskContext,
  imageIds: string[],
  projectId: string,
) {
  const all = new Set(imageIds);
  for (const imageId of imageIds) {
    for (const n of await ctx.neighbours(imageId)) {
      for (const id of [n.image1Id, n.image2Id]) {
        if (all.has(id)) continue;
        const image = await ctx.models.load('Image', { id });
        if (image?.projectId === projectId) all.add(id);
      }
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
  const annotationIds: string[] = [];
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
    annotationIds.push(String(annotation.id));
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
    imageIds: await withNeighbours(ctx, [...imageIds], projectId),
    writeImageIds: [...imageIds],
    locationIds,
    annotationIds,
    pairs,
    setIds: setId ? [setId] : [],
  };
}

function parsedSkip(body: string) {
  try {
    const parsed = JSON.parse(body) as Row;
    return parsed.skipLocationWithAnnotations === true;
  } catch {
    return false;
  }
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
    writeImageIds: scope.writeImageIds,
    locationIds: scope.locationIds,
    annotationIds: scope.annotationIds,
    pairs: scope.pairs,
    readSetIds: scope.setIds,
    writeSetIds: scope.setIds,
    skipIfAnnotated: parsedSkip(message.body),
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
  const { queue, projectId, admin } = await workableQueue(
    ctx,
    argString(args, 'queueId'),
  );
  if (!admin && (await testDue(ctx, projectId)))
    throw new ApiError(409, 'TestDue', 'Take a test before more tasks');
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
    lease.released ||
    lease.acked ||
    lease.expiresAt <= now()
  ) {
    throw notFound('No such task');
  }
  await ctx.access.requireSurveyMember(lease.grantedFor);
  return lease as Lease & { queueUrl: string; receiptHandle: string };
}

// Work saved under another lease, or a task the client may rightly skip.
async function finishedElsewhere(ctx: TaskContext, lease: Lease) {
  if (lease.messageId && lease.locationIds.length) {
    if (
      await ctx.models.load('Observation', {
        id: `queue-message:${lease.messageId}`,
      })
    )
      return true;
    for (const locationId of lease.locationIds) {
      const observations = await queryAll(
        ctx,
        'Observation',
        'observationsByLocationId',
        { locationId },
      );
      if (
        observations.some((o) =>
          lease.writeSetIds.includes(String(o.annotationSetId)),
        )
      )
        return true;
      const location = await ctx.models.load('Location', { id: locationId });
      if (
        !location ||
        !str(location.imageId) ||
        location.width == null ||
        location.height == null
      )
        return true;
      if (lease.skipIfAnnotated && lease.writeSetIds.length) {
        const annotations = await queryAll(
          ctx,
          'Annotation',
          'annotationsByImageIdAndSetId',
          {
            imageId: String(location.imageId),
            setId: { eq: lease.writeSetIds[0] },
          },
        );
        const box = {
          x: Number(location.x),
          y: Number(location.y),
          width: Number(location.width),
          height: Number(location.height),
        };
        if (
          annotations.some(
            (a) =>
              !String(a.source ?? '').includes('false-negative') &&
              isWithinLocationBounds({ x: Number(a.x), y: Number(a.y) }, box),
          )
        )
          return true;
      }
    }
    return false;
  }
  // A duplicate of work this user already finished under another lease.
  const others = (await ctx.leases.active(ctx.access.userId)).filter(
    (l) => l.leaseId !== lease.leaseId && l.done && l.queueId === lease.queueId,
  );
  const same = (a: string[] = [], b: string[] = []) =>
    a.length > 0 && a.every((id) => b.includes(id));
  return others.some(
    (l) =>
      same(lease.annotationIds, l.annotationIds) || same(lease.pairs, l.pairs),
  );
}

export async function ack(ctx: TaskContext, args: Row) {
  const previous = await ctx.leases.get(
    ctx.access.userId,
    argString(args, 'leaseId'),
  );
  if (previous?.acked) return { data: true, testDue: false };
  const lease = await heldQueueLease(ctx, args);
  if (!lease.done && !(await finishedElsewhere(ctx, lease)))
    throw new ApiError(409, 'NotDone', 'Save this task before finishing it');
  if (
    !(await ctx.leases.transition(lease.userId, lease.leaseId, {
      kind: 'ack',
      expiresAt: now() + ACKED_HOLD_SECONDS,
    }))
  )
    throw notFound('No such task');
  await ctx.queue.remove(lease.queueUrl, lease.receiptHandle);
  const testDue = await countTowardsTest(ctx, lease);
  return { data: true, testDue };
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
  // The lease changes first, so a release cannot be undone by an extension.
  const changed =
    seconds === 0
      ? await ctx.leases.transition(lease.userId, lease.leaseId, {
          kind: 'release',
          expiresAt: now(),
        })
      : await ctx.leases.transition(lease.userId, lease.leaseId, {
          kind: 'extend',
          expiresAt: Math.max(
            lease.expiresAt,
            now() + seconds + UNACKED_GRACE_SECONDS,
          ),
        });
  if (!changed) throw notFound('No such task');
  await ctx.queue.visibility(lease.queueUrl, lease.receiptHandle, seconds);
  return { data: true };
}

// Saving a task's work through the router marks the leases it came from.
export async function markDone(
  ctx: TaskContext,
  match: (lease: Lease) => boolean,
) {
  const leases = (await ctx.leases.active(ctx.access.userId)).filter(
    (l) => l.kind === 'queue' && !l.acked && !l.released && !l.done && match(l),
  );
  await Promise.all(
    leases.map((l) =>
      ctx.leases.transition(l.userId, l.leaseId, { kind: 'done' }),
    ),
  );
}

// Writes that finish a task let its lease be acknowledged.
export async function noteSavedWork(
  ctx: TaskContext,
  model: string,
  op: 'create' | 'update',
  row: Row,
) {
  if (model === 'Observation' && op === 'create') {
    const id = str(row.id);
    if (id?.startsWith('queue-message:')) {
      const messageId = id.slice('queue-message:'.length);
      await markDone(ctx, (l) => l.messageId === messageId);
    }
  } else if (model === 'Annotation' && op === 'update' && row.reviewedBy) {
    await markDone(ctx, (l) =>
      Boolean(l.annotationIds?.includes(String(row.id))),
    );
  } else if (model === 'ImageNeighbour' && op === 'update') {
    const pair = `${row.image1Id}|${row.image2Id}`;
    const reverse = `${row.image2Id}|${row.image1Id}`;
    await markDone(
      ctx,
      (l) => l.pairs.includes(pair) || l.pairs.includes(reverse),
    );
  }
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

async function testConfig(ctx: TaskContext, projectId: string) {
  if (!(await ctx.access.isTested(projectId))) return null;
  const config = await ctx.models.load('ProjectTestConfig', { projectId });
  if (!config || !str(config.testType) || config.testType === 'none')
    return null;
  return config;
}

const cadenceState = (projectId: string) => `cadence#${projectId}`;

// Tests fall due on the server, from the work the tester finishes.
async function countTowardsTest(ctx: TaskContext, lease: Lease) {
  if (!lease.messageId || !lease.locationIds.length) return false;
  const config = await testConfig(ctx, lease.grantedFor);
  if (!config) return false;
  const observation = await ctx.models.load('Observation', {
    id: `queue-message:${lease.messageId}`,
  });
  // Skipped tasks do not count, as in the browser.
  if (!observation) return false;
  const name = cadenceState(lease.grantedFor);
  const state = (await ctx.leases.getState(lease.userId, name)) ?? {};
  let unannotated = Number(state.unannotated ?? 0);
  const completed = Number(state.completed ?? 0) + 1;
  let due = state.due === true;
  if (Number(observation.annotationCount ?? 0) > 0) unannotated = 0;
  else {
    unannotated += 1;
    if (config.testType === 'interval') {
      const interval = Number(config.interval ?? 0);
      if (interval > 0 && unannotated >= interval) due = true;
    } else if (config.testType === 'random') {
      if (
        completed > Number(config.deadzone ?? 0) &&
        Math.random() < Number(config.random ?? 0) / 100
      )
        due = true;
    }
  }
  await ctx.leases.putState(lease.userId, name, {
    unannotated,
    completed,
    due,
  });
  return due;
}

async function clearTestDue(ctx: TaskContext, projectId: string) {
  const name = cadenceState(projectId);
  const state = await ctx.leases.getState(ctx.access.userId, name);
  if (!state?.due) return;
  await ctx.leases.putState(ctx.access.userId, name, {
    ...state,
    unannotated: 0,
    due: false,
  });
}

export async function testDue(ctx: TaskContext, projectId: string) {
  const state = await ctx.leases.getState(
    ctx.access.userId,
    cadenceState(projectId),
  );
  return state?.due === true && Boolean(await testConfig(ctx, projectId));
}

interface TestCandidate {
  testPresetId: string;
  locationId: string;
  annotationSetId: string;
  // Served again because every location has been tested.
  repeat: boolean;
}

// Untested locations newest first; once all are tested, the least recently
// tested come round again.
async function testCandidates(
  ctx: TaskContext,
  projectId: string,
): Promise<TestCandidate[]> {
  const [links, taken] = await Promise.all([
    queryAll(ctx, 'TestPresetProject', 'testPresetsByProjectId', {
      projectId,
    }),
    queryAll(ctx, 'TestResult', 'testResultsByUserId', {
      userId: ctx.access.userId,
    }),
  ]);
  const lastTested = new Map<string, string>();
  for (const r of taken) {
    const id = String(r.locationId);
    const at = String(r.createdAt ?? '');
    if (!lastTested.has(id) || at > lastTested.get(id)!) lastTested.set(id, at);
  }
  const entries = (
    await Promise.all(
      links.map((link) =>
        queryAll(ctx, 'TestPresetLocation', 'locationsByTestPresetId', {
          testPresetId: link.testPresetId,
        }),
      ),
    )
  ).flat();
  const unique = new Map<string, Row>();
  for (const entry of entries) {
    const id = String(entry.locationId);
    if (!unique.has(id)) unique.set(id, entry);
  }
  const all = [...unique.values()];
  const fresh = all
    .filter((e) => !lastTested.has(String(e.locationId)))
    .sort((a, b) =>
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
    );
  const again = all
    .filter((e) => lastTested.has(String(e.locationId)))
    .sort((a, b) =>
      lastTested
        .get(String(a.locationId))!
        .localeCompare(lastTested.get(String(b.locationId))!),
    );
  const candidate = (e: Row, repeat: boolean) => ({
    testPresetId: String(e.testPresetId),
    locationId: String(e.locationId),
    annotationSetId: String(e.annotationSetId),
    repeat,
  });
  return [
    ...fresh.map((e) => candidate(e, false)),
    ...again.map((e) => candidate(e, true)),
  ];
}

async function serveTest(
  ctx: TaskContext,
  lease: Lease,
  location: Row,
  imageSize: Size | undefined,
) {
  const test = lease.test!;
  const [referenceNames, pool, annotations] = await Promise.all([
    categoryNames(ctx, test.annotationSetId),
    ctx.access.testPool(),
    queryAll(ctx, 'Annotation', 'annotationsByImageIdAndSetId', {
      imageId: test.imageId,
      setId: { eq: test.annotationSetId },
    }),
  ]);
  // Every test box on the image is hidden, wherever its location row is indexed.
  const hidden: Box[] = [
    test.answerBox,
    ...(pool.boxes.get(test.imageId) ?? [])
      .filter((b) => b.setId === test.annotationSetId)
      .map((b) => b.box),
  ];
  const context = annotations
    .filter(
      (a) =>
        a.setId === test.annotationSetId &&
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
      testPresetId: test.testPresetId,
      annotationSetId: test.annotationSetId,
      location: {
        id: test.locationId,
        x: location.x,
        y: location.y,
        width: location.width,
        height: location.height,
        image: imageSize,
      },
      box: test.box,
      grown: test.grown,
      context,
    },
  };
}

// The server picks the test; the browser only says which job it is for.
export async function test(ctx: TaskContext, args: Row) {
  const projectId = argString(args, 'projectId');
  const jobSetId = argString(args, 'jobAnnotationSetId');
  await ctx.access.requireSurveyMember(projectId);
  if (!(await testConfig(ctx, projectId))) return { data: null };
  const jobSet = await ctx.models.load('AnnotationSet', { id: jobSetId });
  if (jobSet?.projectId !== projectId)
    throw forbidden('The job set is not in this survey');
  const tile = isObject(args.tile)
    ? { tile: sizeArg(args.tile.tile), image: sizeArg(args.tile.image) }
    : undefined;
  if (tile && (!tile.tile || !tile.image)) throw badRequest('Invalid tile');

  // An open test is served again until it is submitted.
  const reused = (await ctx.leases.active(ctx.access.userId)).find(
    (l) =>
      l.kind === 'test' &&
      l.grantedFor === projectId &&
      l.test?.jobSetId === jobSetId &&
      !l.test.submitted,
  );
  if (reused?.test) {
    const location = await ctx.models.load('Location', {
      id: reused.test.locationId,
    });
    const image = await ctx.models.load('Image', { id: reused.test.imageId });
    if (location) return serveTest(ctx, reused, location, sizeArg(image));
  }

  const jobNames = await categoryNames(ctx, jobSetId);
  const labels = new Set([...jobNames.values()].map((n) => n.toLowerCase()));
  for (const candidate of await testCandidates(ctx, projectId)) {
    const location = await ctx.models.load('Location', {
      id: candidate.locationId,
    });
    if (!location || !str(location.imageId)) continue;
    const imageId = String(location.imageId);
    const image = await ctx.models.load('Image', { id: imageId });
    const imageSize = sizeArg(image);
    const answerBox: Box = {
      x: Number(location.x),
      y: Number(location.y),
      width: Number(location.width),
      height: Number(location.height),
    };
    let box = answerBox;
    let grown = false;
    if (tile) {
      if (!imageSize) continue;
      const fitted = growTestBox(
        box,
        tileSizeForImage({ tile: tile.tile!, image: tile.image! }, imageSize),
        imageSize,
        candidate.locationId,
      );
      if (!fitted) continue;
      box = fitted;
      grown = true;
    }
    const test = {
      ...candidate,
      jobSetId,
      imageId,
      box,
      answerBox,
      grown,
      issuedAt: new Date().toISOString(),
    };
    const key = await testKey(ctx, test);
    // A tester cannot answer with labels their job lacks.
    if (key.some((k) => !labels.has(k.category.name.toLowerCase()))) continue;
    const lease: Lease = {
      userId: ctx.access.userId,
      leaseId: randomUUID(),
      kind: 'test',
      projectId: String(location.projectId),
      grantedFor: projectId,
      imageIds: await withNeighbours(
        ctx,
        [imageId],
        String(location.projectId),
      ),
      locationIds: [candidate.locationId],
      pairs: [],
      readSetIds: [],
      writeSetIds: [],
      test,
      expiresAt: now() + HOLD_SECONDS,
    };
    await ctx.leases.put(lease);
    return serveTest(ctx, lease, location, imageSize);
  }
  // Nothing left to test with, so the tester is not held up.
  await clearTestDue(ctx, projectId);
  return { data: null };
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
  // The same label at the same spot counts once.
  const placed = new Set<string>();
  for (const mark of marks as { x: number; y: number; categoryId: string }[]) {
    const name = jobNames.get(mark.categoryId)?.toLowerCase();
    if (name === undefined || !isWithinLocationBounds(mark, test.answerBox))
      continue;
    const spot = `${name}|${Math.round(mark.x)}|${Math.round(mark.y)}`;
    if (placed.has(spot)) continue;
    placed.add(spot);
    userCounts[name] = (userCounts[name] ?? 0) + 1;
  }
  const testAnimals = key.reduce((a, k) => a + k.count, 0);
  const keyed = new Map(key.map((k) => [k.category.name.toLowerCase(), k]));
  // Labels the key lacks are wrong answers, kept with a test count of nought.
  const counts = [
    ...key.map((k) => ({
      categoryName: k.category.name,
      userCount: userCounts[k.category.name.toLowerCase()] ?? 0,
      testCount: k.count,
    })),
    ...Object.entries(userCounts)
      .filter(([name]) => !keyed.has(name))
      .map(([name, userCount]) => ({
        categoryName:
          [...jobNames.values()].find((n) => n.toLowerCase() === name) ?? name,
        userCount,
        testCount: 0,
      })),
  ];
  const matched = counts.reduce(
    (a, c) => a + Math.min(c.userCount, c.testCount),
    0,
  );
  return {
    testAnimals,
    // Wrongly labelled marks do not make up for missed animals.
    totalMissedAnimals: testAnimals - matched,
    falsePositives: counts.reduce(
      (a, c) => a + Math.max(0, c.userCount - c.testCount),
      0,
    ),
    counts,
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
  // One graded attempt per serving: a location the server did not choose to
  // repeat, or one graded since this lease was issued, is not graded again.
  const earlier = await queryAll(ctx, 'TestResult', 'testResultsByUserId', {
    userId: ctx.access.userId,
  });
  const issuedAt = lease.test.issuedAt ?? '';
  if (
    earlier.some(
      (r) =>
        r.locationId === lease.test!.locationId &&
        r.id !== lease.leaseId &&
        (!lease.test!.repeat || String(r.createdAt ?? '') >= issuedAt),
    )
  )
    throw forbidden('This test was already taken');
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
      falsePositives: grade.falsePositives ?? 0,
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
  await clearTestDue(ctx, lease.grantedFor);
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
