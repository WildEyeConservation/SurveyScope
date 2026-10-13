import type { LaunchQCReviewHandler } from '../../data/resource';
import { env } from '$amplify/env/launchQCReview';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { enqueuePretile } from '../shared/enqueuePretile';
import { createShadowWorkflowRun, workflowLaunchUserId } from '../workflowStats/runWriter';

// Inline minimal mutations – return key fields + `group` to avoid nested-resolver
// auth failures while still enabling subscription delivery via groupDefinedIn('group').
const createQueueMutation = /* GraphQL */ `
  mutation CreateQueue($input: CreateQueueInput!) {
    createQueue(input: $input) { id group }
  }
`;

const updateProjectMutation = /* GraphQL */ `
  mutation UpdateProject($input: UpdateProjectInput!, $condition: ModelProjectConditionInput) {
    updateProject(input: $input, condition: $condition) { id group }
  }
`;

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { organizationId }
  }
`;

const queuesByProjectIdQuery = /* GraphQL */ `
  query QueuesByProjectId($projectId: ID!, $limit: Int) {
    queuesByProjectId(projectId: $projectId, limit: $limit) {
      items { id }
    }
  }
`;

// Custom query to fetch annotations by categoryId GSI with reviewCatId for filtering.
const annotationsByCategoryIdQuery = /* GraphQL */ `
  query AnnotationsByCategoryId(
    $categoryId: ID!
    $filter: ModelAnnotationFilterInput
    $limit: Int
    $nextToken: String
  ) {
    annotationsByCategoryId(
      categoryId: $categoryId
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        imageId
        categoryId
        setId
        x
        y
        owner
        reviewCatId
      }
      nextToken
    }
  }
`;

// Configure Amplify so lambda can call the same AppSync API as clients.
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
  }
);

// Shared AppSync data client using IAM auth.
const client = generateClient({
  authMode: 'iam',
});

// Low-level SQS client for queue management and batching.
const sqsClient = new SQSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// S3 client for writing manifests.
const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// ── Types ──

type LaunchQCReviewPayload = {
  projectId: string;
  annotationSetId: string;
  categoryId: string;
  categoryName?: string;
  samplePercent: number;
  batchSize: number;
  hidden: boolean;
  zoom?: number | null;
  annotatorUserIds?: string[];
};

type AnnotationItem = {
  id: string;
  imageId: string;
  categoryId: string;
  setId: string;
  x: number;
  y: number;
  owner: string | null;
  reviewCatId: string | null;
};

type QCManifest = {
  annotationSetId: string;
  categoryId: string;
  annotatorUserIds?: string[];
  samplePercent: number;
  poolSize: number;
  items: Array<{ annotationId: string; imageId: string }>;
};

// ── Handler ──

export const handler: LaunchQCReviewHandler = async (event) => {
  try {
    const payload = parsePayload(event.arguments?.request);

    console.log('launchQCReview invoked', JSON.stringify({
      projectId: payload.projectId,
      annotationSetId: payload.annotationSetId,
      categoryId: payload.categoryId,
      samplePercent: payload.samplePercent,
      batchSize: payload.batchSize,
    }));

    // Fetch the organizationId for authorization and group-based access.
    const projectData = await executeGraphql<{
      getProject?: { organizationId?: string | null };
    }>(getProjectOrganizationId, { id: payload.projectId });
    const organizationId = projectData.getProject?.organizationId;
    if (!organizationId) {
      throw new Error('Unable to determine organizationId for project');
    }

    authorizeRequest(event.identity, organizationId);

    // Conditional update: only proceed if the project is currently 'active'.
    try {
      await setProjectStatus(payload.projectId, 'launching', {
        status: { eq: 'active' },
      });
    } catch (err: any) {
      const msg = err?.message ?? '';
      const errMsgs = Array.isArray(err?.errors)
        ? err.errors.map((e: any) => e?.message ?? '').join(' ')
        : '';
      if (msg.includes('ConditionalCheckFailed') || errMsgs.includes('ConditionalCheckFailed')) {
        console.warn('Launch rejected: project is not in active status', {
          projectId: payload.projectId,
        });
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Project is already launching or processing',
          }),
        };
      }
      throw err;
    }

    const result = await handleLaunch(payload, organizationId, workflowLaunchUserId(event.identity));

    // Project stays in `launching` until reconcilePretileLaunches confirms
    // every image in the pretile manifest has `Image.tiledAt` stamped.

    // Trigger membership refresh so the frontend subscription picks up the status change.
    executeGraphql<{ updateProjectMemberships?: string | null }>(
      updateProjectMembershipsMutation,
      { projectId: payload.projectId }
    ).catch((err) => console.warn('Failed to update project memberships', err));

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error: any) {
    console.error('Error launching QC review job', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to launch QC review job',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

// ── Core launch logic ──

async function handleLaunch(payload: LaunchQCReviewPayload, organizationId: string, launchedBy: string) {
  const {
    projectId,
    annotationSetId,
    categoryId,
    samplePercent,
    batchSize,
    hidden,
    annotatorUserIds,
  } = payload;

  // 1. Fetch all annotations for the given categoryId, filtered to this annotationSet.
  console.log('Fetching annotations for category', { categoryId, annotationSetId });
  const allAnnotations = await fetchAnnotationsByCategory(categoryId, annotationSetId);
  console.log('Fetched annotations', { total: allAnnotations.length });

  // 2. Filter by annotator if specified.
  let candidates = allAnnotations;
  if (annotatorUserIds && annotatorUserIds.length > 0) {
    const annotatorSet = new Set(annotatorUserIds);
    candidates = candidates.filter((a) => a.owner && annotatorSet.has(a.owner));
    console.log('Filtered by annotators', {
      annotatorCount: annotatorUserIds.length,
      remaining: candidates.length,
    });
  }

  // 3. Exclude already-reviewed annotations (reviewCatId is set).
  candidates = candidates.filter((a) => !a.reviewCatId);
  console.log('Excluded already-reviewed', { remaining: candidates.length });

  if (candidates.length === 0) {
    await setProjectStatus(projectId, 'active');
    return {
      queueId: null,
      sampleCount: 0,
      poolSize: 0,
      message: 'No unreviewed annotations found for the selected criteria',
    };
  }

  // 4. Sample using Fisher-Yates shuffle.
  const sampleCount = Math.max(1, Math.round((candidates.length * samplePercent) / 100));
  const sampled = randomSample(candidates, sampleCount);
  console.log('Sampled annotations', {
    poolSize: candidates.length,
    samplePercent,
    sampleCount: sampled.length,
  });

  // 5. Write QC manifest to S3.
  const manifest: QCManifest = {
    annotationSetId,
    categoryId,
    annotatorUserIds,
    samplePercent,
    poolSize: candidates.length,
    items: sampled.map((a) => ({ annotationId: a.id, imageId: a.imageId })),
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestKey = `qc-review-manifests/${annotationSetId}/${categoryId}/${timestamp}.json`;
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: manifestKey,
      Body: JSON.stringify(manifest),
      ContentType: 'application/json',
    })
  );
  console.log('Wrote QC manifest to S3', { manifestKey, itemCount: sampled.length });

  // 6. Guard: prevent duplicate queues for the same project.
  const existingQueue = await findExistingQueue(projectId);
  if (existingQueue) {
    console.warn('Duplicate queue launch blocked', {
      projectId,
      existingQueueId: existingQueue.id,
    });
    await setProjectStatus(projectId, 'active');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'A queue already exists for this project',
        queueId: existingQueue.id,
      }),
    };
  }

  // 7. Create the SQS queue and Queue record.
  // `name` carries the category name (displayed as the heading on Jobs page).
  // `tag` stays 'qc-review' (used by requeue lambda for branching).
  const queueDisplayName = payload.categoryName || 'QC Review';
  const queue = await createQueue(
    { name: queueDisplayName, hidden, fifo: false },
    'qc-review',
    projectId,
    batchSize,
    organizationId,
    payload.zoom,
    {
      annotationSetId,
      launchedCount: sampled.length,
      manifestKey,
      items: sampled.map((a) => ({ annotationId: a.id, imageId: a.imageId })),
    }
  );

  await createShadowWorkflowRun(
    {
      runId: queue.id,
      workflowType: 'qc-review',
      projectId,
      annotationSetId,
      displayName: queueDisplayName,
      configuration: { categoryId, samplePercent, batchSize, annotatorUserIds, launchedCount: sampled.length },
    },
    { userId: launchedBy, organizationId }
  );

  // 7. Enqueue SQS messages.
  await enqueueAnnotations(queue.url, queue.id, sampled);

  // 8. Pre-tile every image in this launch. Project stays `launching` until
  // the reconciler clears the manifest.
  const imageIds = Array.from(new Set(sampled.map((a) => a.imageId)));
  if (!env.PRETILE_QUEUE_URL) {
    throw new Error('PRETILE_QUEUE_URL not set');
  }
  if (!env.REFRESH_TILES_QUEUE_URL) {
    throw new Error('REFRESH_TILES_QUEUE_URL not set');
  }
  const pretileResult = await enqueuePretile({
    projectId,
    annotationSetId,
    workflow: 'qc-review',
    imageIds,
    executeGraphql,
    outputsBucket: bucketName,
    queueUrl: env.PRETILE_QUEUE_URL,
    refreshQueueUrl: env.REFRESH_TILES_QUEUE_URL,
    sqsClient,
    s3Client,
  });

  // When every image was already fresh, enqueuePretile wrote no manifest, so
  // the reconciler will never flip this project to 'active'. Do it here.
  if (pretileResult.noWorkNeeded) {
    await setProjectStatus(projectId, 'active');
  }

  console.log('QC review job launched', {
    queueId: queue.id,
    sampleCount: sampled.length,
    poolSize: candidates.length,
  });

  return {
    queueId: queue.id,
    sampleCount: sampled.length,
    poolSize: candidates.length,
  };
}

// ── Data fetching ──

async function fetchAnnotationsByCategory(
  categoryId: string,
  annotationSetId: string
): Promise<AnnotationItem[]> {
  const allItems: AnnotationItem[] = [];
  let nextToken: string | null = null;
  const pageLimit = 10000;

  do {
    const variables: Record<string, any> = {
      categoryId,
      filter: { setId: { eq: annotationSetId } },
      limit: pageLimit,
    };
    if (nextToken) {
      variables.nextToken = nextToken;
    }

    const result = await executeGraphql<{
      annotationsByCategoryId?: {
        items: AnnotationItem[];
        nextToken?: string | null;
      };
    }>(annotationsByCategoryIdQuery, variables);

    const page = result.annotationsByCategoryId;
    if (page?.items) {
      allItems.push(...page.items);
    }
    nextToken = page?.nextToken ?? null;
  } while (nextToken);

  return allItems;
}

// ── Queue creation ──

async function createQueue(
  queueOptions: { name: string; hidden: boolean; fifo: boolean },
  queueTag: string,
  projectId: string,
  batchSize: number,
  organizationId: string,
  zoom: number | null | undefined,
  trackingParams: {
    annotationSetId: string;
    launchedCount: number;
    manifestKey: string;
    items: Array<{ annotationId: string; imageId: string }>;
  }
) {
  const queueId = randomUUID();
  const safeBaseName = makeSafeQueueName(`${queueOptions.name}-${queueId}`);
  const finalName = queueOptions.fifo ? `${safeBaseName}.fifo` : safeBaseName;

  const createResult = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: finalName,
      Attributes: {
        MessageRetentionPeriod: '1209600',
        FifoQueue: queueOptions.fifo ? 'true' : undefined,
      },
    })
  );

  const queueUrl = createResult.QueueUrl;
  if (!queueUrl) {
    throw new Error('Unable to determine created queue URL');
  }

  // Write queue manifest to S3 for requeue tracking.
  // For QC queues, manifest items reference annotations (not locations).
  const queueManifestKey = `queue-manifests/${queueId}.json`;
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: queueManifestKey,
      Body: JSON.stringify({ items: trackingParams.items }),
      ContentType: 'application/json',
    })
  );
  console.log('Wrote queue manifest to S3', {
    queueManifestKey,
    itemCount: trackingParams.items.length,
  });

  const timestamp = new Date().toISOString();
  const queueData = await executeGraphql<{
    createQueue?: { id: string };
  }>(createQueueMutation, {
    input: {
      id: queueId,
      url: queueUrl,
      name: queueOptions.name,
      projectId,
      batchSize,
      zoom: zoom ?? undefined,
      hidden: queueOptions.hidden,
      tag: queueTag,
      approximateSize: 1,
      updatedAt: timestamp,
      requeueAt: timestamp,
      annotationSetId: trackingParams.annotationSetId,
      launchedCount: trackingParams.launchedCount,
      observedCount: 0,
      locationManifestS3Key: trackingParams.manifestKey,
      requeuesCompleted: 0,
      group: organizationId,
    },
  });

  const createdQueue = queueData.createQueue;
  if (!createdQueue?.id) {
    throw new Error('Failed to record queue metadata');
  }

  return { id: createdQueue.id, url: queueUrl };
}

// Check if any queue already exists for this project.
async function findExistingQueue(
  projectId: string
): Promise<{ id: string } | null> {
  const data = await executeGraphql<{
    queuesByProjectId?: {
      items: Array<{ id: string }>;
    };
  }>(queuesByProjectIdQuery, {
    projectId,
    limit: 1,
  });
  const first = data.queuesByProjectId?.items?.[0];
  return first ? { id: first.id } : null;
}

// ── SQS enqueueing ──

async function enqueueAnnotations(
  queueUrl: string,
  queueId: string,
  annotations: AnnotationItem[]
) {
  const sqsBatchSize = 10;
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];
  const dispatchStart = Date.now();

  console.log('Dispatching SQS batches', {
    queueUrl,
    batches: Math.ceil(annotations.length / sqsBatchSize),
  });

  for (let i = 0; i < annotations.length; i += sqsBatchSize) {
    const batch = annotations.slice(i, i + sqsBatchSize);
    const entries = batch.map((annotation) => {
      const body = JSON.stringify({
        annotation: {
          id: annotation.id,
          annotationSetId: annotation.setId,
          imageId: annotation.imageId,
          categoryId: annotation.categoryId,
          x: annotation.x,
          y: annotation.y,
        },
        queueId,
      });
      return { Id: `msg-${annotation.id}`, MessageBody: body };
    });

    tasks.push(
      limit(async () => {
        await sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: entries,
          })
        );
      })
    );
  }

  await Promise.all(tasks);
  console.log('Finished dispatching SQS batches', {
    totalAnnotations: annotations.length,
    durationMs: Date.now() - dispatchStart,
  });
}

// ── Utility functions ──

function parsePayload(request: unknown): LaunchQCReviewPayload {
  if (typeof request !== 'string') {
    throw new Error('Launch payload is required');
  }
  const parsed = JSON.parse(request);
  if (
    !parsed?.projectId ||
    !parsed?.annotationSetId ||
    !parsed?.categoryId ||
    parsed?.samplePercent == null
  ) {
    throw new Error('Launch payload missing required fields (projectId, annotationSetId, categoryId, samplePercent)');
  }
  return {
    projectId: parsed.projectId,
    annotationSetId: parsed.annotationSetId,
    categoryId: parsed.categoryId,
    categoryName: parsed.categoryName,
    samplePercent: parsed.samplePercent,
    batchSize: parsed.batchSize ?? 200,
    hidden: parsed.hidden ?? false,
    zoom: Number.isInteger(parsed.zoom) ? parsed.zoom : undefined,
    annotatorUserIds: parsed.annotatorUserIds,
  };
}

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const response = (await client.graphql({
    query,
    variables,
  } as any)) as GraphQLResult<T>;
  if (response.errors && response.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(
        response.errors.map((err) => err.message)
      )}`
    );
  }
  if (!response.data) {
    throw new Error('GraphQL response missing data');
  }
  return response.data;
}

function makeSafeQueueName(input: string): string {
  let sanitized = input.replace(/[^a-zA-Z0-9-_]/g, '_');
  const maxMainLength = 75;
  if (sanitized.length > maxMainLength) {
    sanitized = sanitized.substring(0, maxMainLength);
  }
  return sanitized;
}

async function setProjectStatus(
  projectId: string,
  status: string,
  condition?: { status: { eq: string } }
) {
  await executeGraphql<{ updateProject?: { id: string } }>(updateProjectMutation, {
    input: { id: projectId, status },
    ...(condition ? { condition } : {}),
  });
}

function randomSample<T>(arr: T[], count: number): T[] {
  if (count <= 0) return [];
  if (count >= arr.length) return arr.slice();
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}
