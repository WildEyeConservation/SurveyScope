import type { LaunchHomographyHandler } from '../../data/resource';
import { env } from '$amplify/env/launchHomography';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  CreateQueueCommand,
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { enqueuePretile } from '../shared/enqueuePretile';
import { createShadowWorkflowRun, workflowLaunchUserId } from '../workflowStats/runWriter';
import { assertNewQueueUrl, buildQueueName, queueTags } from '../shared/queueNames';
import { isUnder, KIND_TAGS, manifestPrefixFor } from '../shared/s3Keys';

// ── GraphQL queries & mutations ──

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { organizationId }
  }
`;

const createQueueMutation = /* GraphQL */ `
  mutation CreateQueue($input: CreateQueueInput!) {
    createQueue(input: $input) { id group }
  }
`;

const updateProjectMutation = /* GraphQL */ `
  mutation UpdateProject($input: UpdateProjectInput!) {
    updateProject(input: $input) { id group }
  }
`;

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

// ── Amplify config ──

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
        clearCredentialsAndIdentityId: () => {},
      },
    },
  }
);

const client = generateClient({ authMode: 'iam' });

const sqsClient = new SQSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// ── Types ──

type LaunchHomographyPayload = {
  projectId: string;
  annotationSetId: string;
  batchSize: number;
  hidden: boolean;
  manifestS3Key: string;
  launchedCount: number;
  queueName: string;
};

type HomographyImageMeta = {
  id: string;
  width: number;
  height: number;
  timestamp: number | null;
  originalPath: string | null;
  projectId: string;
  latitude: number | null;
  longitude: number | null;
  altitude_wgs84: number | null;
  cameraSerial: string | null;
  group: string | null;
};

type ManifestItem = {
  pairKey: string;
  image1Id: string;
  image2Id: string;
  annotationSetId: string;
  primaryImage: HomographyImageMeta;
  secondaryImage: HomographyImageMeta;
};

type HomographyPairPayload = {
  pairKey: string;
  queueId: string;
  annotationSetId: string;
  primaryImage: HomographyImageMeta;
  secondaryImage: HomographyImageMeta;
};

// ── Handler ──

export const handler: LaunchHomographyHandler = async (event) => {
  try {
    const payload = parsePayload(event.arguments?.request);

    console.log('launchHomography invoked', JSON.stringify({
      projectId: payload.projectId,
      annotationSetId: payload.annotationSetId,
      manifestS3Key: payload.manifestS3Key,
      launchedCount: payload.launchedCount,
    }));

    const projectData = await executeGraphql<{
      getProject?: { organizationId?: string | null };
    }>(getProjectOrganizationId, { id: payload.projectId });
    const organizationId = projectData.getProject?.organizationId;
    if (!organizationId) {
      throw new Error('Unable to determine organizationId for project');
    }

    authorizeRequest(event.identity, organizationId);

    await setProjectStatus(payload.projectId, 'launching');

    const result = await handleLaunch(payload, organizationId, workflowLaunchUserId(event.identity));

    // Project stays in `launching` until reconcilePretileLaunches confirms
    // every image in the pretile manifest has `Image.tiledAt` stamped.

    executeGraphql<{ updateProjectMemberships?: string | null }>(
      updateProjectMembershipsMutation,
      { projectId: payload.projectId }
    ).catch((err) => console.warn('Failed to update project memberships', err));

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error: any) {
    console.error('Error launching homography job', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to launch homography job',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

// ── Core launch logic ──

async function handleLaunch(payload: LaunchHomographyPayload, organizationId: string, launchedBy: string) {
  const { projectId, annotationSetId, batchSize, hidden, manifestS3Key, launchedCount, queueName } = payload;
  if (!isUnder(manifestS3Key, manifestPrefixFor(KIND_TAGS.homography))) {
    throw new Error('Manifest is outside the homography manifest prefix');
  }

  // 1. Download the pre-computed manifest from S3
  console.log('Downloading manifest from S3', { manifestS3Key });
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) throw new Error('OUTPUTS_BUCKET_NAME not set');

  const getResult = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: manifestS3Key })
  );
  const manifestBody = await getResult.Body?.transformToString();
  if (!manifestBody) throw new Error('Empty manifest from S3');

  const manifest: { items: ManifestItem[] } = JSON.parse(manifestBody);
  const manifestItems = manifest.items;

  if (manifestItems.length === 0) {
    // Nothing to pre-tile or enqueue — reset project so the UI is not stuck.
    await setProjectStatus(projectId, 'active');
    return { queueId: null, pairCount: 0, message: 'Manifest contained no pairs' };
  }

  console.log('Manifest loaded', { pairCount: manifestItems.length });

  // 2. Create SQS queue
  const queueId = randomUUID();
  const queueDisplayName = queueName;
  const safeQueueName = buildQueueName('Homography', queueId);

  const createResult = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: safeQueueName,
      Attributes: { MessageRetentionPeriod: '1209600' },
      tags: queueTags(projectId, queueId),
    })
  );
  const queueUrl = createResult.QueueUrl;
  if (!queueUrl) throw new Error('Unable to determine created queue URL');
  await assertNewQueueUrl(queueUrl, safeQueueName, executeGraphql);

  // 3. Create Queue DynamoDB record
  const timestamp = new Date().toISOString();
  await executeGraphql<{ createQueue?: { id: string } }>(createQueueMutation, {
    input: {
      id: queueId,
      url: queueUrl,
      name: queueDisplayName,
      projectId,
      batchSize,
      hidden,
      tag: KIND_TAGS.homography,
      approximateSize: 1,
      updatedAt: timestamp,
      requeueAt: timestamp,
      annotationSetId,
      launchedCount: launchedCount,
      observedCount: 0,
      locationManifestS3Key: manifestS3Key,
      requeuesCompleted: 0,
      group: organizationId,
    },
  });

  await createShadowWorkflowRun(
    {
      runId: queueId,
      workflowType: 'homographies',
      projectId,
      annotationSetId,
      displayName: queueDisplayName,
      configuration: { batchSize, launchedCount: manifestItems.length, manifestS3Key },
    },
    { userId: launchedBy, organizationId }
  );

  // 4. Build pair payloads and enqueue
  const pairs: HomographyPairPayload[] = manifestItems.map((item) => ({
    pairKey: item.pairKey,
    queueId,
    annotationSetId,
    primaryImage: item.primaryImage,
    secondaryImage: item.secondaryImage,
  }));

  await enqueuePairs(queueUrl, pairs);

  // Pre-tile all images this launch will touch. Project stays in `launching`
  // until reconcilePretileLaunches flips it back once every image has
  // `Image.tiledAt` set.
  const imageIds = Array.from(
    new Set(
      manifestItems.flatMap((item) => [item.primaryImage.id, item.secondaryImage.id])
    )
  );
  if (!env.PRETILE_QUEUE_URL) {
    throw new Error('PRETILE_QUEUE_URL not set');
  }
  if (!env.REFRESH_TILES_QUEUE_URL) {
    throw new Error('REFRESH_TILES_QUEUE_URL not set');
  }
  const pretileResult = await enqueuePretile({
    projectId,
    annotationSetId,
    workflow: 'homography',
    imageIds,
    executeGraphql,
    outputsBucket: bucketName,
    queueUrl: env.PRETILE_QUEUE_URL,
    refreshQueueUrl: env.REFRESH_TILES_QUEUE_URL,
    sqsClient,
    s3Client,
  });

  // When every image was already fresh, no manifest was written and the
  // reconciler will never flip this project back to 'active'. Flip it here so
  // the UI isn't stuck in 'launching' for a project that had no tiling work.
  if (pretileResult.noWorkNeeded) {
    await setProjectStatus(projectId, 'active');
  }

  console.log('Homography job launched', { queueId, pairCount: pairs.length });
  return { queueId, pairCount: pairs.length };
}

// ── SQS enqueueing ──

async function enqueuePairs(queueUrl: string, pairs: HomographyPairPayload[]) {
  const sqsBatchSize = 10;
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];

  console.log('Dispatching SQS batches', {
    queueUrl,
    batches: Math.ceil(pairs.length / sqsBatchSize),
  });

  for (let i = 0; i < pairs.length; i += sqsBatchSize) {
    const batch = pairs.slice(i, i + sqsBatchSize);
    const entries = batch.map((pair, j) => ({
      Id: `msg-${i + j}`,
      MessageBody: JSON.stringify(pair),
    }));

    tasks.push(
      limit(async () => {
        const response = await sqsClient.send(
          new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries })
        );
        if (response.Failed && response.Failed.length > 0) {
          throw new Error(
            `SQS batch had ${response.Failed.length} failures: ${JSON.stringify(response.Failed)}`
          );
        }
      })
    );
  }

  await Promise.all(tasks);
  console.log('Finished dispatching SQS batches', { totalPairs: pairs.length });
}

// ── Utility functions ──

function parsePayload(request: unknown): LaunchHomographyPayload {
  if (typeof request !== 'string') throw new Error('Launch payload is required');
  const parsed = JSON.parse(request);
  if (!parsed?.projectId || !parsed?.annotationSetId || !parsed?.manifestS3Key) {
    throw new Error('Launch payload missing required fields (projectId, annotationSetId, manifestS3Key)');
  }
  return {
    projectId: parsed.projectId,
    annotationSetId: parsed.annotationSetId,
    batchSize: parsed.batchSize ?? 50,
    hidden: parsed.hidden ?? false,
    manifestS3Key: parsed.manifestS3Key,
    launchedCount: parsed.launchedCount ?? 0,
    queueName: parsed.queueName ?? `Homography - ${parsed.annotationSetId.substring(0, 8)}`,
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
      `GraphQL error: ${JSON.stringify(response.errors.map((err) => err.message))}`
    );
  }
  if (!response.data) throw new Error('GraphQL response missing data');
  return response.data;
}

async function setProjectStatus(projectId: string, status: string) {
  await executeGraphql<{ updateProject?: { id: string } }>(updateProjectMutation, {
    input: { id: projectId, status },
  });
}
