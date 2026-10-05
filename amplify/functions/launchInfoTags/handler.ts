import type { LaunchInfoTagsHandler } from '../../data/resource';
import { env } from '$amplify/env/launchInfoTags';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  CreateQueueCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { enqueuePretile } from '../shared/enqueuePretile';
import { enqueueInfoTagImages } from './enqueueImages';
import { createShadowWorkflowRun, workflowLaunchUserId } from '../workflowStats/runWriter';
import {
  assertInputsBelongToProject,
  parsePayload,
  type LaunchInfoTagsPayload,
} from './validation';

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

const getAnnotationSetProjectId = /* GraphQL */ `
  query GetAnnotationSet($id: ID!) {
    getAnnotationSet(id: $id) { id projectId }
  }
`;

const getCategoryOwnership = /* GraphQL */ `
  query GetCategory($id: ID!) {
    getCategory(id: $id) { id projectId annotationSetId }
  }
`;

const queuesByProjectIdQuery = /* GraphQL */ `
  query QueuesByProjectId($projectId: ID!, $limit: Int) {
    queuesByProjectId(projectId: $projectId, limit: $limit) {
      items { id }
    }
  }
`;

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
        infoTaggedBy
      }
      nextToken
    }
  }
`;

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

const client = generateClient({ authMode: 'iam' });
const credentials = {
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  sessionToken: env.AWS_SESSION_TOKEN,
};
const sqsClient = new SQSClient({ region: env.AWS_REGION, credentials });
const s3Client = new S3Client({ region: env.AWS_REGION, credentials });

type AnnotationItem = {
  id: string;
  imageId: string;
  categoryId: string;
  setId: string;
  x: number;
  y: number;
  infoTaggedBy: string | null;
};

type ImageWorkItem = {
  imageId: string;
  annotationIds: string[];
};

type InfoTagManifest = {
  annotationSetId: string;
  categoryIds: string[];
  items: ImageWorkItem[];
};

export const handler: LaunchInfoTagsHandler = async (event) => {
  try {
    const payload = parsePayload(event.arguments?.request);
    console.log(
      'launchInfoTags invoked',
      JSON.stringify({
        projectId: payload.projectId,
        annotationSetId: payload.annotationSetId,
        categoryIds: payload.categoryIds,
        batchSize: payload.batchSize,
      })
    );

    const projectData = await executeGraphql<{
      getProject?: { organizationId?: string | null };
    }>(getProjectOrganizationId, { id: payload.projectId });
    const organizationId = projectData.getProject?.organizationId;
    if (!organizationId) {
      throw new Error('Unable to determine organizationId for project');
    }
    authorizeRequest(event.identity, organizationId);
    await assertPayloadOwnership(payload);

    try {
      await setProjectStatus(payload.projectId, 'launching', {
        status: { eq: 'active' },
      });
    } catch (err: any) {
      const msg = err?.message ?? '';
      const errorMessages = Array.isArray(err?.errors)
        ? err.errors.map((item: any) => item?.message ?? '').join(' ')
        : '';
      if (
        msg.includes('ConditionalCheckFailed') ||
        errorMessages.includes('ConditionalCheckFailed')
      ) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'Project is already launching or processing',
          }),
        };
      }
      throw err;
    }

    // The project is already flagged as launching, so anything that fails from
    // here has to hand it back or the survey stays locked.
    let result;
    try {
      result = await handleLaunch(payload, organizationId, workflowLaunchUserId(event.identity));
    } catch (error) {
      await setProjectStatus(payload.projectId, 'active').catch((statusError) =>
        console.error(
          'Failed to restore project status after launch failure',
          statusError
        )
      );
      throw error;
    }

    executeGraphql<{ updateProjectMemberships?: string | null }>(
      updateProjectMembershipsMutation,
      { projectId: payload.projectId }
    ).catch((err) =>
      console.warn('Failed to update project memberships', err)
    );

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error: any) {
    console.error('Error launching informational tagging job', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to launch informational tagging job',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

async function handleLaunch(
  payload: LaunchInfoTagsPayload,
  organizationId: string,
  launchedBy: string
) {
  const {
    projectId,
    annotationSetId,
    categoryIds,
    batchSize,
    hidden,
  } = payload;

  const limit = pLimit(10);
  const perCategory = await Promise.all(
    categoryIds.map((categoryId) =>
      limit(() => fetchAnnotationsByCategory(categoryId, annotationSetId))
    )
  );
  const candidates = perCategory.flat().filter((item) => !item.infoTaggedBy);

  if (candidates.length === 0) {
    await setProjectStatus(projectId, 'active');
    return {
      queueId: null,
      annotationCount: 0,
      imageCount: 0,
      message: 'No untagged annotations found for the selected labels',
    };
  }

  const byImage = new Map<string, string[]>();
  for (const annotation of candidates) {
    const annotationIds = byImage.get(annotation.imageId);
    if (annotationIds) annotationIds.push(annotation.id);
    else byImage.set(annotation.imageId, [annotation.id]);
  }
  const items: ImageWorkItem[] = Array.from(byImage, ([imageId, annotationIds]) => ({
    imageId,
    annotationIds,
  }));

  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestKey = `info-tag-manifests/${annotationSetId}/${timestamp}.json`;
  const manifest: InfoTagManifest = {
    annotationSetId,
    categoryIds,
    items,
  };
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: manifestKey,
      Body: JSON.stringify(manifest),
      ContentType: 'application/json',
    })
  );

  const existingQueue = await findExistingQueue(projectId);
  if (existingQueue) {
    await setProjectStatus(projectId, 'active');
    return {
      queueId: existingQueue.id,
      message: 'A queue already exists for this project',
    };
  }

  const joinedNames = (payload.categoryNames ?? []).join(', ').trim();
  const displayName = truncate(joinedNames || 'Info Tags', 120);
  const queue = await createQueue(
    { name: displayName, hidden },
    projectId,
    batchSize,
    organizationId,
    {
      annotationSetId,
      launchedCount: items.length,
      manifestKey,
      items,
    }
  );

  await createShadowWorkflowRun(
    {
      runId: queue.id,
      workflowType: 'info-tags',
      projectId,
      annotationSetId,
      displayName,
      configuration: { categoryIds, batchSize, launchedCount: items.length, annotationCount: candidates.length },
    },
    { userId: launchedBy, organizationId }
  );

  await enqueueInfoTagImages(
    { queueUrl: queue.url, queueId: queue.id, annotationSetId, categoryIds, items },
    (command) => sqsClient.send(command)
  );

  if (!env.PRETILE_QUEUE_URL) throw new Error('PRETILE_QUEUE_URL not set');
  if (!env.REFRESH_TILES_QUEUE_URL) {
    throw new Error('REFRESH_TILES_QUEUE_URL not set');
  }
  const pretileResult = await enqueuePretile({
    projectId,
    annotationSetId,
    workflow: 'info-tags',
    imageIds: items.map((item) => item.imageId),
    executeGraphql,
    outputsBucket: bucketName,
    queueUrl: env.PRETILE_QUEUE_URL,
    refreshQueueUrl: env.REFRESH_TILES_QUEUE_URL,
    sqsClient,
    s3Client,
  });
  if (pretileResult.noWorkNeeded) {
    await setProjectStatus(projectId, 'active');
  }

  return {
    queueId: queue.id,
    annotationCount: candidates.length,
    imageCount: items.length,
  };
}

async function fetchAnnotationsByCategory(
  categoryId: string,
  annotationSetId: string
): Promise<AnnotationItem[]> {
  const items: AnnotationItem[] = [];
  let nextToken: string | null = null;
  do {
    const variables: Record<string, unknown> = {
      categoryId,
      filter: { setId: { eq: annotationSetId } },
      limit: 10000,
      ...(nextToken ? { nextToken } : {}),
    };
    const result = await executeGraphql<{
      annotationsByCategoryId?: {
        items: AnnotationItem[];
        nextToken?: string | null;
      };
    }>(annotationsByCategoryIdQuery, variables);
    items.push(...(result.annotationsByCategoryId?.items ?? []));
    nextToken = result.annotationsByCategoryId?.nextToken ?? null;
  } while (nextToken);
  return items;
}

async function createQueue(
  options: { name: string; hidden: boolean },
  projectId: string,
  batchSize: number,
  organizationId: string,
  tracking: {
    annotationSetId: string;
    launchedCount: number;
    manifestKey: string;
    items: ImageWorkItem[];
  }
) {
  const queueId = randomUUID();
  const safeDisplayName = makeSafeQueueName(options.name);
  const queueName = `${safeDisplayName}-${queueId}`;
  const result = await sqsClient.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: { MessageRetentionPeriod: '1209600' },
    })
  );
  if (!result.QueueUrl) throw new Error('Unable to determine created queue URL');

  const bucketName = env.OUTPUTS_BUCKET_NAME;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: `queue-manifests/${queueId}.json`,
      Body: JSON.stringify({ items: tracking.items }),
      ContentType: 'application/json',
    })
  );

  const timestamp = new Date().toISOString();
  const queueData = await executeGraphql<{
    createQueue?: { id: string };
  }>(createQueueMutation, {
    input: {
      id: queueId,
      url: result.QueueUrl,
      name: options.name,
      projectId,
      batchSize,
      hidden: options.hidden,
      tag: 'info-tags',
      approximateSize: tracking.launchedCount,
      updatedAt: timestamp,
      requeueAt: timestamp,
      annotationSetId: tracking.annotationSetId,
      launchedCount: tracking.launchedCount,
      observedCount: 0,
      infoTagProtocolVersion: 1,
      locationManifestS3Key: tracking.manifestKey,
      requeuesCompleted: 0,
      group: organizationId,
    },
  });
  if (!queueData.createQueue?.id) {
    throw new Error('Failed to record queue metadata');
  }
  return { id: queueData.createQueue.id, url: result.QueueUrl };
}

async function findExistingQueue(projectId: string) {
  const data = await executeGraphql<{
    queuesByProjectId?: { items: Array<{ id: string }> };
  }>(queuesByProjectIdQuery, { projectId, limit: 1 });
  return data.queuesByProjectId?.items?.[0] ?? null;
}

async function assertPayloadOwnership(payload: LaunchInfoTagsPayload) {
  const limit = pLimit(10);
  const [annotationSetData, categories] = await Promise.all([
    executeGraphql<{
      getAnnotationSet?: { id: string; projectId: string } | null;
    }>(getAnnotationSetProjectId, { id: payload.annotationSetId }),
    Promise.all(
      payload.categoryIds.map((id) =>
        limit(async () => {
          const data = await executeGraphql<{
            getCategory?: {
              id: string;
              projectId: string;
              annotationSetId: string;
            } | null;
          }>(getCategoryOwnership, { id });
          return data.getCategory ?? null;
        })
      )
    ),
  ]);

  assertInputsBelongToProject(
    payload,
    annotationSetData.getAnnotationSet,
    categories
  );
}

async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = (await client.graphql({
    query,
    variables,
  } as any)) as GraphQLResult<T>;
  if (response.errors?.length) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(
        response.errors.map((error) => error.message)
      )}`
    );
  }
  if (!response.data) throw new Error('GraphQL response missing data');
  return response.data;
}

async function setProjectStatus(
  projectId: string,
  status: string,
  condition?: { status: { eq: string } }
) {
  await executeGraphql(updateProjectMutation, {
    input: { id: projectId, status },
    ...(condition ? { condition } : {}),
  });
}

function makeSafeQueueName(input: string) {
  return truncate(input.replace(/[^a-zA-Z0-9-_]/g, '_'), 40);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
