import { env } from '$amplify/env/launchFalseNegatives';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Context } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import pLimit from 'p-limit';
import { createTileMarker } from '../falseNegativeSamples/marking';
import {
  isCoveredByPrimaryWork,
  isUsableTile,
  sampleDraw,
  sampleTarget,
  stagingThreshold,
} from '../falseNegativeSamples/sampling';
import {
  createSampleStore,
  imageKeyOf,
  pendingCount,
  SUMMARY_SK,
  tileSk,
  type SampleJob,
  type SampleRow,
  type SampleSummary,
} from '../falseNegativeSamples/store';
import { authorizeRequest } from '../shared/authorizeRequest';
import { enqueuePretile } from '../shared/enqueuePretile';
import {
  createShadowWorkflowRun,
  workflowLaunchUserId,
} from '../workflowStats/runWriter';
import {
  deleteFalseNegativeWork,
  loadPrimaryWork,
  tilePages,
  type DataTables,
  type PrimaryWork,
} from './reads';

const FALSE_NEGATIVES_QUEUE = 'False Negatives';
// A job that has not reported for this long has died without cleaning up.
const STALE_JOB_MS = 20 * 60 * 1000;
// Leave enough of the 15 minutes to save progress and hand over.
const HAND_OVER_MS = 150 * 1000;

Amplify.configure(
  {
    API: {
      GraphQL: {
        endpoint: env.AMPLIFY_DATA_GRAPHQL_ENDPOINT,
        region: env.AWS_REGION,
        defaultAuthMode: 'iam',
      },
    },
  },
  {
    Auth: {
      credentialsProvider: {
        getCredentialsAndIdentityId: async () => ({
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN,
          },
        }),
        clearCredentialsAndIdentityId: () => {
          /* noop */
        },
      },
    },
  },
);

const client = generateClient({ authMode: 'iam' });
const credentials = {
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  sessionToken: env.AWS_SESSION_TOKEN,
};
const sqsClient = new SQSClient({ region: env.AWS_REGION, credentials });
const s3Client = new S3Client({ region: env.AWS_REGION, credentials });
const lambdaClient = new LambdaClient({ region: env.AWS_REGION, credentials });
const ssmClient = new SSMClient({ region: env.AWS_REGION, credentials });
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: env.AWS_REGION, maxAttempts: 8 }),
  { marshallOptions: { removeUndefinedValues: true } },
);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

let dataTables: Promise<DataTables> | undefined;
const tables = () =>
  (dataTables ??= ssmClient
    .send(
      new GetParameterCommand({
        Name: requiredEnv('FALSE_NEGATIVE_TABLES_PARAMETER'),
      }),
    )
    .then((result) => JSON.parse(result.Parameter!.Value!) as DataTables));
const store = () =>
  createSampleStore(db, requiredEnv('FALSE_NEGATIVE_SAMPLES_TABLE'));

const getProjectQuery = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      organizationId
      status
      tiledLocationSetId
    }
  }
`;
const getAnnotationSetQuery = /* GraphQL */ `
  query GetAnnotationSet($id: ID!) {
    getAnnotationSet(id: $id) {
      projectId
    }
  }
`;
const getLocationSetQuery = /* GraphQL */ `
  query GetLocationSet($id: ID!) {
    getLocationSet(id: $id) {
      locationCount
    }
  }
`;
const queuesByProjectIdQuery = /* GraphQL */ `
  query QueuesByProjectId($projectId: ID!, $limit: Int, $nextToken: String) {
    queuesByProjectId(
      projectId: $projectId
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        name
        annotationSetId
      }
      nextToken
    }
  }
`;
// Return key fields + `group` so subscriptions deliver via groupDefinedIn.
const createQueueMutation = /* GraphQL */ `
  mutation CreateQueue($input: CreateQueueInput!) {
    createQueue(input: $input) {
      id
      group
    }
  }
`;
const updateQueueMutation = /* GraphQL */ `
  mutation UpdateQueue($input: UpdateQueueInput!) {
    updateQueue(input: $input) {
      id
      group
    }
  }
`;
const createTasksOnAnnotationSetMutation = /* GraphQL */ `
  mutation CreateTasksOnAnnotationSet(
    $input: CreateTasksOnAnnotationSetInput!
  ) {
    createTasksOnAnnotationSet(input: $input) {
      id
      group
    }
  }
`;
const updateProjectMutation = /* GraphQL */ `
  mutation UpdateProject(
    $input: UpdateProjectInput!
    $condition: ModelProjectConditionInput
  ) {
    updateProject(input: $input, condition: $condition) {
      id
      group
    }
  }
`;
const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

type Identity = { sub?: string; groups?: string[] | null } | null | undefined;

type LaunchRequest = {
  action: 'launch' | 'continue' | 'reset';
  projectId: string;
  annotationSetId: string;
  samplePercent?: number;
  queueTag?: string;
  batchSize?: number;
  zoom?: number | null;
};

type WorkerEvent = { worker: true; annotationSetId: string; jobId: string };

// An a.handler.function resolver sends the field name at the top level.
type AppSyncEvent = {
  arguments?: Record<string, unknown>;
  identity?: Identity;
  fieldName?: string;
};

export const handler = async (
  event: AppSyncEvent | WorkerEvent,
  context: Context,
) => {
  if ('worker' in event) return runWorker(event, context);
  if (event.fieldName === 'getFalseNegativesStatus') {
    return getStatus(event);
  }
  return startJob(event, context);
};

// ── Status ──

async function getStatus(event: AppSyncEvent) {
  const projectId = String(event.arguments?.projectId ?? '');
  const annotationSetId = String(event.arguments?.annotationSetId ?? '');
  if (!projectId || !annotationSetId) {
    throw new Error('projectId and annotationSetId are required');
  }
  const project = await getProject(projectId);
  authorizeRequest(event.identity, project.organizationId);

  let summary = await store().getSummary(annotationSetId);
  if (summary && summary.projectId !== projectId) {
    throw new Error('Annotation set does not belong to this survey');
  }
  if (summary) summary = await failIfStale(summary);
  const queues = await projectQueues(projectId);
  return {
    sample: summary && {
      state: summary.state,
      step: summary.step ?? null,
      error: summary.error ?? null,
      action: summary.job?.action ?? null,
      unreviewedTiles: summary.unreviewedTiles,
      evaluatedAt: summary.evaluatedAt ?? null,
      sampledCount: summary.sampledCount,
      reviewedCount: summary.reviewedCount,
      coveredCount: summary.coveredCount,
      foundCount: summary.foundCount,
      pendingCount: pendingCount(summary),
      launches: summary.launches,
    },
    queueActive: queues.some(
      (queue) =>
        queue.name === FALSE_NEGATIVES_QUEUE &&
        queue.annotationSetId === annotationSetId,
    ),
    surveyBusy: queues.length > 0,
  };
}

async function failIfStale(summary: SampleSummary): Promise<SampleSummary> {
  if (
    summary.state !== 'working' ||
    Date.now() - Date.parse(summary.updatedAt) < STALE_JOB_MS
  ) {
    return summary;
  }
  console.warn('Releasing a job that stopped reporting', {
    annotationSetId: summary.annotationSetId,
    job: summary.job,
  });
  await failJob(
    summary,
    new Error('The job stopped unexpectedly. Nothing was lost; try again.'),
  );
  return (await store().getSummary(summary.annotationSetId)) ?? summary;
}

// ── Request ──

function parseRequest(raw: unknown): LaunchRequest {
  if (typeof raw !== 'string') throw new Error('Launch payload is required');
  const parsed = JSON.parse(raw) as Partial<LaunchRequest>;
  if (
    !parsed.projectId ||
    !parsed.annotationSetId ||
    !['launch', 'continue', 'reset'].includes(String(parsed.action))
  ) {
    throw new Error('Launch payload missing required fields');
  }
  return parsed as LaunchRequest;
}

async function startJob(event: AppSyncEvent, context: Context) {
  const request = parseRequest(event.arguments?.request);
  const { projectId, annotationSetId, action } = request;
  console.log('launchFalseNegatives request', JSON.stringify(request));

  const project = await getProject(projectId);
  authorizeRequest(event.identity, project.organizationId);
  const set = await executeGraphql<{
    getAnnotationSet?: { projectId?: string | null } | null;
  }>(getAnnotationSetQuery, { id: annotationSetId });
  if (set.getAnnotationSet?.projectId !== projectId) {
    throw new Error('Annotation set does not belong to this survey');
  }

  let summary = await store().getSummary(annotationSetId);
  if (summary) summary = await failIfStale(summary);
  if (summary?.state === 'working') {
    throw new Error('A False Negatives job is already being prepared');
  }

  const queues = await projectQueues(projectId);
  const base = {
    id: randomUUID(),
    action,
    startedAt: new Date().toISOString(),
    launchedBy: workflowLaunchUserId(event.identity),
    percent: 0,
    queueTag: request.queueTag || FALSE_NEGATIVES_QUEUE,
    batchSize: request.batchSize || 200,
    zoom: request.zoom ?? null,
    seed: randomUUID(),
    launchNo: (summary?.launches.length ?? 0) + 1,
    threshold: 0,
    tilesRead: 0,
    unreviewed: 0,
    alreadySampled: 0,
    enqueued: 0,
  };

  if (action === 'reset') {
    if (!summary)
      throw new Error('There is no False Negatives sample to reset');
    if (
      queues.some(
        (queue) =>
          queue.name === FALSE_NEGATIVES_QUEUE &&
          queue.annotationSetId === annotationSetId,
      )
    ) {
      throw new Error(
        'Cancel the running False Negatives job before resetting',
      );
    }
    const job: SampleJob = { ...base, phase: 'reset' };
    await store().updateSummary(annotationSetId, {
      state: 'working',
      step: 'Deleting false negative reviews',
      error: undefined,
      job,
    });
    await invokeWorker(context, annotationSetId, job.id, { ...summary, job });
    return { ok: true };
  }

  const locationSetId = project.tiledLocationSetId;
  if (!locationSetId) {
    throw new Error(
      'This survey has no tiles yet. Create them in Manage Tiles.',
    );
  }
  if (queues.length > 0) {
    throw new Error(
      'A job is already running on this survey. Wait for it to finish or cancel it first.',
    );
  }
  if (summary && summary.locationSetId !== locationSetId) {
    throw new Error(
      'The survey was re-tiled after this sample was drawn. Reset the false negative data first.',
    );
  }

  let job: SampleJob;
  if (action === 'continue') {
    if (!summary || pendingCount(summary) === 0) {
      throw new Error('No sampled tiles are waiting for review');
    }
    job = { ...base, phase: 'enqueue', launchNo: summary.launches.length };
  } else {
    const percent = Number(request.samplePercent ?? 0);
    if (!(percent > 0 && percent <= 100)) {
      throw new Error('Sample size must be between 0 and 100 percent');
    }
    const locationSet = await executeGraphql<{
      getLocationSet?: { locationCount?: number | null } | null;
    }>(getLocationSetQuery, { id: locationSetId });
    const totalTiles = locationSet.getLocationSet?.locationCount ?? 0;
    // Before the first launch every tile may still be unreviewed.
    const expectedUnreviewed = summary?.unreviewedTiles || totalTiles;
    const expectedAvailable = summary
      ? expectedUnreviewed - (summary.sampledCount - summary.coveredCount)
      : expectedUnreviewed;
    job = {
      ...base,
      phase: 'sample',
      percent,
      threshold: stagingThreshold(
        percent,
        expectedUnreviewed,
        expectedAvailable,
        totalTiles,
      ),
    };
  }

  // Only one launch may prepare a survey at a time.
  try {
    await setProjectStatus(projectId, 'launching', {
      status: { eq: 'active' },
    });
  } catch (error) {
    if (String((error as Error)?.message).includes('ConditionalCheckFailed')) {
      throw new Error('This survey is busy. Try again once it is active.');
    }
    throw error;
  }

  try {
    const starting = {
      state: 'working' as const,
      step: 'Starting',
      error: undefined,
      job,
    };
    if (summary) {
      await store().updateSummary(annotationSetId, starting);
    } else {
      summary = {
        annotationSetId,
        sk: SUMMARY_SK,
        projectId,
        organizationId: project.organizationId,
        locationSetId,
        unreviewedTiles: 0,
        sampledCount: 0,
        reviewedCount: 0,
        coveredCount: 0,
        foundCount: 0,
        launches: [],
        updatedAt: new Date().toISOString(),
        ...starting,
      };
      await store().putSummary(summary, 'absent');
    }
    await executeGraphql(updateProjectMembershipsMutation, { projectId });
    await invokeWorker(context, annotationSetId, job.id, { ...summary, job });
  } catch (error) {
    await setProjectStatus(projectId, 'active').catch(console.error);
    throw error;
  }
  return { ok: true };
}

async function invokeWorker(
  context: Context,
  annotationSetId: string,
  jobId: string,
  summary: SampleSummary,
) {
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: context.functionName,
        InvocationType: 'Event',
        Payload: JSON.stringify({
          worker: true,
          annotationSetId,
          jobId,
        } satisfies WorkerEvent),
      }),
    );
  } catch (error) {
    await failJob(summary, error);
    throw error;
  }
}

// ── Worker ──

class HandOver extends Error {}

async function runWorker(event: WorkerEvent, context: Context) {
  const summary = await store().getSummary(event.annotationSetId);
  const job = summary?.job;
  // A newer request, or a failure, has replaced this job.
  if (
    !summary ||
    !job ||
    summary.state !== 'working' ||
    job.id !== event.jobId
  ) {
    console.warn(
      'Ignoring a worker event for a job that is no longer current',
      {
        event,
      },
    );
    return { ignored: true };
  }
  const outOfTime = () => context.getRemainingTimeInMillis() < HAND_OVER_MS;
  try {
    if (job.phase === 'reset') await runReset(summary, job, outOfTime);
    if (job.phase === 'sample') await runSample(summary, job, outOfTime);
    if (job.phase === 'enqueue') await runEnqueue(summary, job, outOfTime);
    return { done: true };
  } catch (error) {
    if (error instanceof HandOver) {
      await invokeWorker(context, summary.annotationSetId, job.id, summary);
      return { handedOver: true };
    }
    console.error('False negatives job failed', error);
    await failJob(summary, error);
    return { failed: true };
  }
}

async function failJob(summary: SampleSummary, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await store()
    .updateSummary(summary.annotationSetId, {
      state: 'failed',
      step: undefined,
      error: message,
      job: undefined,
    })
    .catch((failure) => console.error('Could not record the failure', failure));
  if (summary.job?.action !== 'reset') {
    await setProjectStatus(summary.projectId, 'active').catch((failure) =>
      console.error('Could not unlock the survey', failure),
    );
    await executeGraphql(updateProjectMembershipsMutation, {
      projectId: summary.projectId,
    }).catch(console.error);
  }
}

async function saveJob(summary: SampleSummary, job: SampleJob, step: string) {
  await store().updateSummary(summary.annotationSetId, { job, step });
}

// ── Sample ──

async function runSample(
  summary: SampleSummary,
  job: SampleJob,
  outOfTime: () => boolean,
) {
  const samples = store();
  const { annotationSetId } = summary;
  const dataTableNames = await tables();
  const marker = tileMarker(dataTableNames);
  await saveJob(summary, job, 'Loading the locations already reviewed');
  const work = await withTiming('loadPrimaryWork', () =>
    loadPrimaryWork(db, dataTableNames, annotationSetId),
  );

  const existing = new Map<string, SampleRow>();
  const leftovers: string[] = [];
  for (const row of await withTiming('loadSampleRows', () =>
    samples.allRows(annotationSetId),
  )) {
    if (row.launchNo < job.launchNo) existing.set(row.tileId, row);
    // Rows of an earlier launch that never finished.
    else if (!job.cursor) leftovers.push(row.sk);
  }
  if (leftovers.length) await samples.deleteRows(annotationSetId, leftovers);
  if (!job.cursor) await recheckRows([...existing.values()], work, marker);

  let staged: SampleRow[] = [];
  const flush = async () => {
    if (!staged.length) return;
    const rows = staged;
    staged = [];
    await samples.putRows(rows);
  };

  const streamStart = Date.now();
  for await (const { tiles, nextKey } of tilePages(
    db,
    dataTableNames,
    summary.locationSetId,
    job.cursor,
  )) {
    for (const tile of tiles) {
      if (!isUsableTile(tile)) continue;
      const covered = isCoveredByPrimaryWork(
        tile,
        work.reviewed.get(tile.imageId),
        work.annotations.get(tile.imageId),
      );
      if (covered) continue;
      job.unreviewed += 1;
      if (existing.has(tile.id)) {
        job.alreadySampled += 1;
        continue;
      }
      const draw = sampleDraw(job.seed, tile.id);
      if (draw >= job.threshold) continue;
      staged.push({
        annotationSetId,
        sk: tileSk(tile.id),
        tileId: tile.id,
        imageId: tile.imageId,
        imageKey: imageKeyOf(annotationSetId, tile.imageId),
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        launchNo: job.launchNo,
        draw,
        status: 'pending',
      });
    }
    job.tilesRead += tiles.length;
    job.cursor = nextKey;
    if (staged.length >= 2000) await flush();
    const mustHandOver = outOfTime() && !!nextKey;
    if (mustHandOver || job.tilesRead % 100_000 < tiles.length) {
      await flush();
      await saveJob(
        summary,
        job,
        `Finding tiles nobody has looked at (${job.tilesRead.toLocaleString('en')} checked)`,
      );
    }
    if (mustHandOver) throw new HandOver();
  }
  await flush();
  console.log('[Timing] tile stream complete', {
    durationMs: Date.now() - streamStart,
    tilesRead: job.tilesRead,
    unreviewed: job.unreviewed,
  });

  // Keep exactly the lowest draws; the rest were only a safety margin.
  const drawn = (await samples.allRows(annotationSetId))
    .filter((row) => row.launchNo === job.launchNo)
    .sort((a, b) => a.draw - b.draw);
  const target = sampleTarget(
    job.percent,
    job.unreviewed,
    job.unreviewed - job.alreadySampled,
  );
  const kept = drawn.slice(0, target);
  if (kept.length < target) {
    console.warn('Sample came up short of its target', {
      target,
      drawn: drawn.length,
    });
  }
  await samples.deleteRows(
    annotationSetId,
    drawn.slice(target).map((row) => row.sk),
  );
  console.log('Sample drawn', {
    percent: job.percent,
    unreviewed: job.unreviewed,
    alreadySampled: job.alreadySampled,
    target,
    kept: kept.length,
  });

  const launches = kept.length
    ? [
        ...summary.launches,
        {
          launchNo: job.launchNo,
          launchedAt: job.startedAt,
          launchedBy: job.launchedBy,
          percent: job.percent,
          count: kept.length,
        },
      ]
    : summary.launches;
  const next: SampleJob = { ...job, phase: 'enqueue', cursor: undefined };
  await samples.updateSummary(
    annotationSetId,
    {
      unreviewedTiles: job.unreviewed,
      evaluatedAt: new Date().toISOString(),
      launches,
      job: next,
      step: 'Creating the job',
    },
    { sampledCount: kept.length },
  );
  // The queue gets a fresh time budget.
  Object.assign(job, next);
  throw new HandOver();
}

const tileMarker = (dataTableNames: DataTables) =>
  createTileMarker(db, {
    samples: requiredEnv('FALSE_NEGATIVE_SAMPLES_TABLE'),
    ...dataTableNames,
  });

// Repairs any row the observation stream failed to update.
async function recheckRows(
  rows: SampleRow[],
  work: PrimaryWork,
  marker: ReturnType<typeof createTileMarker>,
) {
  for (const row of rows) {
    if (row.status === 'covered') continue;
    const covered = isCoveredByPrimaryWork(
      row,
      work.reviewed.get(row.imageId),
      work.annotations.get(row.imageId),
    );
    if (covered) {
      if (await marker.coverRow(row)) row.status = 'covered';
      continue;
    }
    const found = work.falseNegativeReviews.get(row.tileId);
    if (row.status !== 'pending' || found === undefined) continue;
    const reviewed = await store().transitionRow(
      row.annotationSetId,
      row.tileId,
      {
        from: ['pending'],
        to: 'reviewed',
        set: { found, reviewedAt: new Date().toISOString() },
        delta: { reviewedCount: 1, foundCount: found },
      },
    );
    if (reviewed) row.status = 'reviewed';
  }
}

// ── Enqueue ──

async function runEnqueue(
  summary: SampleSummary,
  job: SampleJob,
  outOfTime: () => boolean,
) {
  const samples = store();
  const { annotationSetId, projectId, organizationId, locationSetId } = summary;
  const rows = await samples.allRows(annotationSetId);
  // A new launch has just re-checked its rows while sampling.
  if (job.action === 'continue' && !job.queueId) {
    const dataTableNames = await tables();
    await recheckRows(
      rows,
      await loadPrimaryWork(db, dataTableNames, annotationSetId),
      tileMarker(dataTableNames),
    );
  }
  const pending = rows.filter((row) => row.status === 'pending');
  if (pending.length === 0) {
    throw new Error(
      job.action === 'continue'
        ? 'No sampled tiles are waiting for review'
        : 'Every tile has already been reviewed, so there is nothing to sample',
    );
  }

  if (!job.queueId || !job.queueUrl) {
    if ((await projectQueues(projectId)).length > 0) {
      throw new Error(
        'Another job was launched on this survey in the meantime',
      );
    }
    const queue = await withTiming('createQueue', () =>
      createQueue(job, summary, pending),
    );
    await createShadowWorkflowRun(
      {
        runId: queue.id,
        workflowType: 'false-negatives',
        projectId,
        annotationSetId,
        displayName: FALSE_NEGATIVES_QUEUE,
        configuration: {
          locationSetId,
          taskTag: job.queueTag,
          batchSize: job.batchSize,
          samplePercent: job.percent,
          isContinuation: job.action === 'continue',
          launchedCount: pending.length,
        },
      },
      { userId: job.launchedBy, organizationId },
    );
    job.queueId = queue.id;
    job.queueUrl = queue.url;
    await saveJob(summary, job, 'Sending tiles to the job');
  }
  const { queueId, queueUrl } = job;

  const remaining = job.lastSk
    ? pending.filter((row) => row.sk > job.lastSk!)
    : pending;
  for (let i = 0; i < remaining.length; i += 5000) {
    const slice = remaining.slice(i, i + 5000);
    await sendTiles(queueUrl, queueId, slice, annotationSetId, job.queueTag);
    job.lastSk = slice[slice.length - 1].sk;
    job.enqueued += slice.length;
    await saveJob(
      summary,
      job,
      `Sending tiles to the job (${job.enqueued.toLocaleString('en')} of ${pending.length.toLocaleString('en')})`,
    );
    if (outOfTime() && i + 5000 < remaining.length) throw new HandOver();
  }

  await executeGraphql(updateQueueMutation, {
    input: {
      id: queueId,
      totalBatches: Math.ceil(pending.length / job.batchSize),
    },
  });
  await executeGraphql(createTasksOnAnnotationSetMutation, {
    input: { annotationSetId, locationSetId, group: organizationId },
  });

  await saveJob(summary, job, 'Preparing image tiles');
  const pretile = await withTiming('enqueuePretile', () =>
    enqueuePretile({
      projectId,
      annotationSetId,
      workflow: 'false-negatives',
      imageIds: [...new Set(pending.map((row) => row.imageId))],
      executeGraphql,
      outputsBucket: requiredEnv('OUTPUTS_BUCKET_NAME'),
      queueUrl: requiredEnv('PRETILE_QUEUE_URL'),
      refreshQueueUrl: requiredEnv('REFRESH_TILES_QUEUE_URL'),
      sqsClient,
      s3Client,
    }),
  );
  if (pretile.noWorkNeeded) await setProjectStatus(projectId, 'active');
  await executeGraphql(updateProjectMembershipsMutation, { projectId });

  await samples.updateSummary(annotationSetId, {
    state: 'ready',
    step: undefined,
    error: undefined,
    job: undefined,
  });
  console.log('False negatives launch complete', {
    annotationSetId,
    queueId,
    tiles: pending.length,
  });
}

async function createQueue(
  job: SampleJob,
  summary: SampleSummary,
  rows: SampleRow[],
) {
  const queueId = randomUUID();
  const created = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: `${FALSE_NEGATIVES_QUEUE}-${queueId}`
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .substring(0, 75),
      Attributes: { MessageRetentionPeriod: '1209600' },
    }),
  );
  if (!created.QueueUrl)
    throw new Error('Unable to determine created queue URL');

  // Read by findAndRequeueMissingLocations.
  const manifestKey = `queue-manifests/${queueId}.json`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: requiredEnv('OUTPUTS_BUCKET_NAME'),
      Key: manifestKey,
      Body: JSON.stringify({
        items: rows.map((row) => ({
          locationId: row.tileId,
          imageId: row.imageId,
          x: row.x,
          y: row.y,
          width: row.width,
          height: row.height,
        })),
      }),
      ContentType: 'application/json',
    }),
  );

  const timestamp = new Date().toISOString();
  await executeGraphql(createQueueMutation, {
    input: {
      id: queueId,
      url: created.QueueUrl,
      name: FALSE_NEGATIVES_QUEUE,
      projectId: summary.projectId,
      batchSize: job.batchSize,
      zoom: job.zoom ?? undefined,
      hidden: false,
      tag: job.queueTag,
      approximateSize: 1,
      updatedAt: timestamp,
      requeueAt: timestamp,
      annotationSetId: summary.annotationSetId,
      locationSetId: summary.locationSetId,
      launchedCount: rows.length,
      observedCount: 0,
      locationManifestS3Key: manifestKey,
      requeuesCompleted: 0,
      group: summary.organizationId,
    },
  });
  return { id: queueId, url: created.QueueUrl };
}

async function sendTiles(
  queueUrl: string,
  queueId: string,
  rows: SampleRow[],
  annotationSetId: string,
  queueTag: string,
) {
  const limit = pLimit(20);
  const batches: SampleRow[][] = [];
  for (let i = 0; i < rows.length; i += 10) batches.push(rows.slice(i, i + 10));
  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        let entries = batch.map((row) => ({
          Id: `msg-${row.tileId}`,
          MessageBody: JSON.stringify({
            location: { id: row.tileId, annotationSetId },
            queueId,
            allowOutside: false,
            taskTag: queueTag,
            skipLocationWithAnnotations: false,
          }),
        }));
        for (let attempt = 0; entries.length; attempt++) {
          if (attempt > 5) {
            throw new Error('Some tiles could not be sent to the job');
          }
          const { Failed } = await sqsClient.send(
            new SendMessageBatchCommand({
              QueueUrl: queueUrl,
              Entries: entries,
            }),
          );
          const failed = new Set((Failed ?? []).map((entry) => entry.Id));
          entries = entries.filter((entry) => failed.has(entry.Id));
        }
      }),
    ),
  );
}

// ── Reset ──

async function runReset(
  summary: SampleSummary,
  job: SampleJob,
  outOfTime: () => boolean,
) {
  const dataTableNames = await tables();
  const interrupted = await withTiming('deleteFalseNegativeWork', () =>
    deleteFalseNegativeWork(
      db,
      dataTableNames,
      summary.annotationSetId,
      { stage: job.resetStage ?? 0, cursor: job.cursor },
      outOfTime,
    ),
  );
  if (interrupted) {
    job.resetStage = interrupted.stage;
    job.cursor = interrupted.cursor;
    await saveJob(summary, job, 'Deleting false negative reviews');
    throw new HandOver();
  }
  const rows = await withTiming('deleteSample', () =>
    store().deleteSample(summary.annotationSetId),
  );
  console.log('False negatives data reset', {
    annotationSetId: summary.annotationSetId,
    rows,
  });
}

// ── Helpers ──

async function getProject(projectId: string) {
  const data = await executeGraphql<{
    getProject?: {
      organizationId?: string | null;
      status?: string | null;
      tiledLocationSetId?: string | null;
    } | null;
  }>(getProjectQuery, { id: projectId });
  const organizationId = data.getProject?.organizationId;
  if (!organizationId) {
    throw new Error('Unable to determine organizationId for project');
  }
  return { ...data.getProject, organizationId };
}

async function projectQueues(projectId: string) {
  const queues: {
    id: string;
    name?: string | null;
    annotationSetId?: string | null;
  }[] = [];
  let nextToken: string | null | undefined;
  do {
    const data: {
      queuesByProjectId?: {
        items: typeof queues;
        nextToken?: string | null;
      };
    } = await executeGraphql(queuesByProjectIdQuery, {
      projectId,
      limit: 100,
      nextToken,
    });
    queues.push(...(data.queuesByProjectId?.items ?? []));
    nextToken = data.queuesByProjectId?.nextToken;
  } while (nextToken);
  return queues;
}

async function setProjectStatus(
  projectId: string,
  status: string,
  condition?: { status: { eq: string } },
) {
  await executeGraphql(updateProjectMutation, {
    input: { id: projectId, status },
    ...(condition ? { condition } : {}),
  });
}

async function withTiming<T>(
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await action();
  } finally {
    console.log(`[Timing] ${label}`, { durationMs: Date.now() - start });
  }
}

async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = (await client.graphql({
    query,
    variables,
  } as never)) as GraphQLResult<T>;
  if (response.errors && response.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(
        response.errors.map((err) => err.message),
      )}`,
    );
  }
  if (!response.data) {
    throw new Error('GraphQL response missing data');
  }
  return response.data;
}
