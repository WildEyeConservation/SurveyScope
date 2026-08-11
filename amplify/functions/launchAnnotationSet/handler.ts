import type { LaunchAnnotationSetHandler } from '../../data/resource';
import { env } from '$amplify/env/launchAnnotationSet';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { authorizeRequest } from '../shared/authorizeRequest';
import { enqueuePretile } from '../shared/enqueuePretile';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageBatchCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import {
  createShadowWorkflowRun,
  workflowLaunchUserId,
} from '../workflowStats/runWriter';
// Inline minimal mutations – return key fields + `group` to avoid nested-resolver
// auth failures while still enabling subscription delivery via groupDefinedIn('group').
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

const updateQueueMutation = /* GraphQL */ `
  mutation UpdateQueue($input: UpdateQueueInput!) {
    updateQueue(input: $input) { id group }
  }
`;

const createLocationSetMutation = /* GraphQL */ `
  mutation CreateLocationSet($input: CreateLocationSetInput!) {
    createLocationSet(input: $input) { id group }
  }
`;

const createLocationMutation = /* GraphQL */ `
  mutation CreateLocation($input: CreateLocationInput!) {
    createLocation(input: $input) { id group }
  }
`;

const createTasksOnAnnotationSetMutation = /* GraphQL */ `
  mutation CreateTasksOnAnnotationSet($input: CreateTasksOnAnnotationSetInput!) {
    createTasksOnAnnotationSet(input: $input) { id group }
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

const createTilingTaskMutation = /* GraphQL */ `
  mutation CreateTilingTask($input: CreateTilingTaskInput!) {
    createTilingTask(input: $input) { id group }
  }
`;

const createTilingBatchMutation = /* GraphQL */ `
  mutation CreateTilingBatch($input: CreateTilingBatchInput!) {
    createTilingBatch(input: $input) { id group }
  }
`;


const updateLocationSetMutation = /* GraphQL */ `
  mutation UpdateLocationSet($input: UpdateLocationSetInput!) {
    updateLocationSet(input: $input) { id group }
  }
`;

const deleteLocationMutation = /* GraphQL */ `
  mutation DeleteLocation($input: DeleteLocationInput!) {
    deleteLocation(input: $input) { id group }
  }
`;

const deleteAnnotationMutation = /* GraphQL */ `
  mutation DeleteAnnotation($input: DeleteAnnotationInput!) {
    deleteAnnotation(input: $input) { id group }
  }
`;

const deleteObservationMutation = /* GraphQL */ `
  mutation DeleteObservation($input: DeleteObservationInput!) {
    deleteObservation(input: $input) { id group }
  }
`;

const getLocationSetQuery = /* GraphQL */ `
  query GetLocationSet($id: ID!) {
    getLocationSet(id: $id) { id name }
  }
`;

const annotationSetsByProjectIdQuery = /* GraphQL */ `
  query AnnotationSetsByProjectId(
    $projectId: ID!
    $limit: Int
    $nextToken: String
  ) {
    annotationSetsByProjectId(
      projectId: $projectId
      limit: $limit
      nextToken: $nextToken
    ) {
      items { id }
      nextToken
    }
  }
`;

const locationsBySetIdAndConfidence = /* GraphQL */ `
  query LocationsBySetIdAndConfidence(
    $setId: ID!
    $limit: Int
    $nextToken: String
  ) {
    locationsBySetIdAndConfidence(
      setId: $setId
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
      }
      nextToken
    }
  }
`;

const queuesByProjectIdQuery = /* GraphQL */ `
  query QueuesByProjectId($projectId: ID!, $limit: Int) {
    queuesByProjectId(projectId: $projectId, limit: $limit) {
      items { id }
    }
  }
`;

// Custom query to fetch observations with source field
const observationsByAnnotationSetId = /* GraphQL */ `
  query ObservationsByAnnotationSetId(
    $annotationSetId: ID!
    $filter: ModelObservationFilterInput
    $limit: Int
    $nextToken: String
  ) {
    observationsByAnnotationSetId(
      annotationSetId: $annotationSetId
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        source
      }
      nextToken
    }
  }
`;

// Custom query to fetch annotations with source field
const annotationsByAnnotationSetId = /* GraphQL */ `
  query AnnotationsByAnnotationSetId(
    $setId: ID!
    $filter: ModelAnnotationFilterInput
    $limit: Int
    $nextToken: String
  ) {
    annotationsByAnnotationSetId(
      setId: $setId
      filter: $filter
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        source
      }
      nextToken
    }
  }
`;

// Configure Amplify to talk to the same AppSync backend the UI uses.
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

// Reuse a single data client with IAM auth.
const client = generateClient({
  authMode: 'iam',
});

// Thin wrapper around SQS for queue creation and batching.
const sqsClient = new SQSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// S3 client for reading large payloads uploaded by the frontend.
const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// Lambda client for invoking tiling batch lambdas.
const lambdaClient = new LambdaClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// Minimal type helpers for payload parsing and validation.
type LaunchQueueOptions = {
  name: string;
  hidden: boolean;
  fifo: boolean;
};

type TiledLaunchImage = {
  id: string;
  width: number;
  height: number;
};

type TiledLaunchRequest = {
  name: string;
  description: string;
  horizontalTiles: number;
  verticalTiles: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  images: TiledLaunchImage[];
  locationCount: number;
  /** Optional: Reuse this existing location set instead of creating a new one */
  existingLocationSetId?: string;
};

type LaunchLambdaPayload = {
  projectId: string;
  annotationSetId: string;
  queueOptions: LaunchQueueOptions;
  allowOutside: boolean;
  skipLocationWithAnnotations: boolean;
  taskTag: string;
  batchSize: number;
  zoom?: number | null;
  locationIds?: string[];
  locationSetIds?: string[];
  tiledRequest?: TiledLaunchRequest | null;
  /** S3 key where the full payload is stored (for large payloads). */
  payloadS3Key?: string;
  locationManifestS3Key?: string | null;
  launchedCount?: number | null;
  /** If true, delete false negative annotations/observations before launching */
  hasFN?: boolean;
  launchImageIds?: string[];
};

type QueueRecord = {
  id: string;
  url: string;
};

// Location data structure for in-memory tile generation
type LocationInput = {
  x: number;
  y: number;
  width: number;
  height: number;
  imageId: string;
  projectId: string;
  setId: string;
};

// Batch size for tiling - 50,000 locations per batch
const TILING_BATCH_SIZE = 50000;

// Entry point invoked by AppSync resolver.
export const handler: LaunchAnnotationSetHandler = async (event) => {
  let payloadS3Key: string | undefined;
  try {
    let payload = parsePayload(event.arguments?.request);

    // If a payloadS3Key is provided, fetch the full payload from S3.
    if (payload.payloadS3Key) {
      payloadS3Key = payload.payloadS3Key;
      console.log('Reading payload from S3', { key: payloadS3Key });
      payload = await readPayloadFromS3(payloadS3Key);
    }

    // Check if this is a tiling-only operation (no annotation set to launch)
    const isTilingOnly = payload.tiledRequest && !payload.annotationSetId;

    console.log(
      'launchAnnotationSet invoked',
      JSON.stringify({
        projectId: payload.projectId,
        annotationSetId: payload.annotationSetId,
        launchMode: payload.tiledRequest ? 'tiled' : 'model-guided',
        isTilingOnly,
        locationIdsProvided: payload.locationIds?.length ?? 0,
        locationSetIdsProvided: payload.locationSetIds?.length ?? 0,
      })
    );

    // Fetch the project's organizationId to set the group field on all created records.
    const projectData = await executeGraphql<{
      getProject?: { organizationId?: string | null };
    }>(getProjectOrganizationId, { id: payload.projectId });
    const organizationId = projectData.getProject?.organizationId;
    if (!organizationId) {
      throw new Error('Project does not have an organizationId');
    }

    authorizeRequest(event.identity, organizationId);

    // Use 'processing' for tiling-only, 'launching' for actual annotation set launches.
    // Conditional update: only proceed if the project is currently 'active'.
    // This acts as an atomic lock — if two launches race, only one wins.
    try {
      await setProjectStatus(
        payload.projectId,
        isTilingOnly ? 'processing' : 'launching',
        { status: { eq: 'active' } }
      );
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

    await executeGraphql<{ updateProjectMemberships?: string | null }>(
      updateProjectMembershipsMutation,
      { projectId: payload.projectId }
    );
    const result = await handleLaunch(
      payload,
      organizationId,
      workflowLaunchUserId(event.identity)
    );

    // Clean up the S3 payload file after successful processing.
    if (payloadS3Key) {
      await deletePayloadFromS3(payloadS3Key);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result),
    };
  } catch (error: any) {
    console.error('Error launching annotation set', error);
    // Attempt to clean up even on error to avoid orphaned files.
    if (payloadS3Key) {
      try {
        await deletePayloadFromS3(payloadS3Key);
      } catch (cleanupError) {
        console.warn('Failed to clean up S3 payload after error', cleanupError);
      }
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to launch annotation set',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

// Read the location manifest the client uploaded and pull out the unique image IDs
type ManifestItem = { locationId: string; imageId: string };

async function readImageIdsFromManifest(key: string): Promise<string[]> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
  const bodyStr = await response.Body?.transformToString();
  if (!bodyStr) {
    throw new Error('Empty manifest file');
  }
  const manifest = JSON.parse(bodyStr) as { items?: ManifestItem[] };
  const items = manifest.items ?? [];
  return Array.from(
    new Set(items.map((i) => i.imageId).filter((id): id is string => !!id))
  );
}

async function handleLaunch(
  payload: LaunchLambdaPayload,
  organizationId: string,
  launchedBy: string
) {
  const locationSetIds = new Set(payload.locationSetIds ?? []);
  const locationIds = payload.locationIds ?? [];

  if (payload.tiledRequest) {
    console.log(
      'Generating tiled location set',
      JSON.stringify({
        projectId: payload.projectId,
        images: payload.tiledRequest.images.length,
        expectedLocations: payload.tiledRequest.locationCount,
      })
    );

    // Use distributed tiling for large tile sets
    const result = await handleDistributedTiling(
      payload,
      organizationId,
      launchedBy
    );
    return result;
  }

  if (!locationIds || locationIds.length === 0) {
    throw new Error('No locations provided to launch');
  }

  // Guard: prevent duplicate queues for the same project and tag
  const existingQueue = await findExistingQueue(payload.projectId);
  if (existingQueue) {
    console.warn('Duplicate queue launch blocked', {
      projectId: payload.projectId,
      existingQueueId: existingQueue.id,
    });
    await setProjectStatus(payload.projectId, 'active');
    return {
      message: 'A queue already exists for this project',
      locationCount: 0,
      queueId: existingQueue.id,
    };
  }

  console.log('Creating queues', {
    primaryName: payload.queueOptions.name,
    totalLocations: locationIds.length,
  });

  // Determine locationSetId from the first locationSetId provided (if any)
  const locationSetId = payload.locationSetIds?.[0];

  const mainQueue = await createQueue(
    payload.queueOptions,
    payload,
    locationIds,
    locationSetId,
    payload.locationManifestS3Key,
    payload.launchedCount,
    organizationId
  );

  await createShadowWorkflowRun(
    {
      runId: mainQueue.id,
      workflowType: 'species-labelling',
      projectId: payload.projectId,
      annotationSetId: payload.annotationSetId,
      displayName: payload.queueOptions.name,
      configuration: {
        locationSetId,
        taskTag: payload.taskTag,
        batchSize: payload.batchSize,
        launchedCount: payload.launchedCount ?? locationIds.length,
        allowOutside: payload.allowOutside,
        skipLocationWithAnnotations: payload.skipLocationWithAnnotations,
      },
    },
    { userId: launchedBy, organizationId }
  );

  await enqueueLocations(
    mainQueue.url,
    mainQueue.id,
    locationIds,
    payload
  );
  console.log('Enqueued locations', {
    queueId: mainQueue.id,
    count: locationIds.length,
  });

  await executeGraphql<{ updateQueue?: { id: string } }>(updateQueueMutation, {
    input: {
      id: mainQueue.id,
      totalBatches: Math.ceil(locationIds.length / payload.batchSize),
    },
  });

  await Promise.all(
    Array.from(locationSetIds).map((locationSetId) =>
      executeGraphql<{ createTasksOnAnnotationSet?: { id: string } }>(
        createTasksOnAnnotationSetMutation,
        {
          input: {
            annotationSetId: payload.annotationSetId,
            locationSetId,
            group: organizationId,
          },
        }
      )
    )
  );

  let pretileImageIds: string[];
  if (payload.launchImageIds && payload.launchImageIds.length > 0) {
    pretileImageIds = Array.from(new Set(payload.launchImageIds));
  } else if (payload.locationManifestS3Key) {
    pretileImageIds = await readImageIdsFromManifest(
      payload.locationManifestS3Key
    );
    console.log('Resolved image IDs from manifest', {
      manifestKey: payload.locationManifestS3Key,
      uniqueImages: pretileImageIds.length,
    });
  } else {
    throw new Error(
      'Cannot resolve image IDs: neither launchImageIds nor locationManifestS3Key was provided'
    );
  }

  let pretileNoWorkNeeded = false;
  if (pretileImageIds.length > 0) {
    if (!env.PRETILE_QUEUE_URL) {
      throw new Error('PRETILE_QUEUE_URL not set');
    }
    if (!env.REFRESH_TILES_QUEUE_URL) {
      throw new Error('REFRESH_TILES_QUEUE_URL not set');
    }
    const pretileBucketName = env.OUTPUTS_BUCKET_NAME;
    if (!pretileBucketName) {
      throw new Error('OUTPUTS_BUCKET_NAME not set');
    }
    const pretileResult = await enqueuePretile({
      projectId: payload.projectId,
      annotationSetId: payload.annotationSetId,
      workflow: 'species-labelling',
      imageIds: pretileImageIds,
      executeGraphql,
      outputsBucket: pretileBucketName,
      queueUrl: env.PRETILE_QUEUE_URL,
      refreshQueueUrl: env.REFRESH_TILES_QUEUE_URL,
      sqsClient,
      s3Client,
    });
    pretileNoWorkNeeded = pretileResult.noWorkNeeded;
  }

  if (pretileImageIds.length === 0 || pretileNoWorkNeeded) {
    await setProjectStatus(payload.projectId, 'active');
  }

  await executeGraphql<{ updateProjectMemberships?: string | null }>(
    updateProjectMembershipsMutation,
    { projectId: payload.projectId }
  );

  console.log('Launch complete', {
    projectId: payload.projectId,
    locationsLaunched: locationIds.length,
  });
  return {
    message: 'Launch request processed',
    locationCount: locationIds.length,
    queueId: mainQueue.id,
  };
}

// Handle distributed tiling for large tile sets
async function handleDistributedTiling(
  payload: LaunchLambdaPayload,
  organizationId: string,
  launchedBy: string
) {
  const tiledRequest = payload.tiledRequest!;
  let locationSetId: string;

  if (tiledRequest.existingLocationSetId) {
    // Retile: archive the old location set and create a fresh one.
    //
    // We deliberately do NOT delete the old locations — doing so via GraphQL is
    // too slow for large projects (some have ~1M locations) and a single Lambda
    // invocation cannot paginate and delete that many records within its timeout.
    // Retiling is a rare, intentional action so leaving stale locations in the
    // archived set is an acceptable trade-off for now. When an efficient
    // bulk-delete mechanism is available (e.g. DynamoDB BatchWriteItem scan or a
    // dedicated cleanup Lambda), add the deletion step here.

    const oldLocationSetId = tiledRequest.existingLocationSetId;

    // Fetch the old set's name so we can form a meaningful archive label.
    const oldSetData = await executeGraphql<{
      getLocationSet?: { id: string; name: string };
    }>(getLocationSetQuery, { id: oldLocationSetId });
    const oldName = oldSetData.getLocationSet?.name ?? 'Location Set';

    // Rename the old set so it's identifiable but clearly no longer active.
    const archiveTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
    await executeGraphql<{ updateLocationSet?: { id: string } }>(
      updateLocationSetMutation,
      {
        input: {
          id: oldLocationSetId,
          name: `${oldName} (archived ${archiveTimestamp})`,
        },
      }
    );
    console.log('Archived old location set', { oldLocationSetId });

    // Wipe FN data — it references old tile geometries and must be cleared.
    await deleteFalseNegativeDataForProject(payload.projectId);

    // Create a brand-new location set to receive the new tiles.
    const newLocationSetData = await executeGraphql<{
      createLocationSet?: { id: string };
    }>(createLocationSetMutation, {
      input: {
        name: tiledRequest.name,
        projectId: payload.projectId,
        description: tiledRequest.description,
        locationCount: tiledRequest.locationCount,
        group: organizationId,
      },
    });

    locationSetId = newLocationSetData.createLocationSet?.id!;
    if (!locationSetId) {
      throw new Error('Unable to create replacement location set');
    }

    // Point the project at the new set so all subsequent workflows use it.
    await executeGraphql<{ updateProject?: { id: string } }>(
      updateProjectMutation,
      {
        input: {
          id: payload.projectId,
          tiledLocationSetId: locationSetId,
        },
      }
    );
    console.log('Created new location set and updated project pointer', {
      oldLocationSetId,
      newLocationSetId: locationSetId,
    });
  } else {
    // First-time tiling: create the location set from scratch.
    const locationSetData = await executeGraphql<{
      createLocationSet?: { id: string };
    }>(createLocationSetMutation, {
      input: {
        name: tiledRequest.name,
        projectId: payload.projectId,
        description: tiledRequest.description,
        locationCount: tiledRequest.locationCount,
        group: organizationId,
      },
    });

    locationSetId = locationSetData.createLocationSet?.id!;
    if (!locationSetId) {
      throw new Error('Unable to create location set');
    }

    console.log('Created location set', { locationSetId });
  }

  // Generate all tile locations in memory
  const locations = generateTiledLocations(
    payload.projectId,
    locationSetId,
    tiledRequest
  );
  console.log('Generated locations in memory', { count: locations.length });

  // Batch locations and write to S3
  const batches = batchLocations(locations, TILING_BATCH_SIZE);
  console.log('Created batches', { batchCount: batches.length });

  // Create the launch config for the control lambda to use later
  const launchConfig = JSON.stringify({
    queueOptions: payload.queueOptions,
    allowOutside: payload.allowOutside,
    skipLocationWithAnnotations: payload.skipLocationWithAnnotations,
    taskTag: payload.taskTag,
    batchSize: payload.batchSize,
    zoom: payload.zoom,
    launchImageIds: payload.launchImageIds, // Pass the filter to the monitor
    launchedBy,
  });

  // Create TilingTask record
  // For tiling-only operations, annotationSetId may not be provided
  const tilingTaskData = await executeGraphql<{
    createTilingTask?: { id: string };
  }>(createTilingTaskMutation, {
    input: {
      projectId: payload.projectId,
      locationSetId,
      annotationSetId: payload.annotationSetId || 'tiling-only',
      status: 'processing',
      launchConfig,
      totalBatches: batches.length,
      completedBatches: 0,
      totalLocations: locations.length,
      group: organizationId,
    },
  });

  const tilingTaskId = tilingTaskData.createTilingTask?.id;
  if (!tilingTaskId) {
    throw new Error('Failed to create tiling task');
  }

  console.log('Created tiling task', {
    tilingTaskId,
    totalBatches: batches.length,
  });

  // Write batches to S3 and create TilingBatch records (but don't invoke yet)
  const batchCreationLimit = pLimit(10);
  const batchTasks = batches.map((batch, index) =>
    batchCreationLimit(async () => {
      // Write batch to S3
      const s3Key = `tiling-batches/${tilingTaskId}-batch-${index}.json`;
      await writeBatchToS3(s3Key, batch);

      // Create TilingBatch record
      const batchData = await executeGraphql<{
        createTilingBatch?: { id: string };
      }>(createTilingBatchMutation, {
        input: {
          tilingTaskId,
          batchIndex: index,
          status: 'pending',
          inputS3Key: s3Key,
          locationCount: batch.length,
          createdCount: 0,
          group: organizationId,
        },
      });

      const batchId = batchData.createTilingBatch?.id;
      if (!batchId) {
        throw new Error(`Failed to create tiling batch ${index}`);
      }

      console.log('Created tiling batch', {
        batchId,
        batchIndex: index,
        locationCount: batch.length,
      });

      return { batchId, batchIndex: index };
    })
  );

  const createdBatches = await Promise.all(batchTasks);

  // Sort by batchIndex to ensure we get the first one
  createdBatches.sort((a, b) => a.batchIndex - b.batchIndex);

  // Invoke ONLY the first batch (index 0) - it will chain to subsequent batches
  const firstBatch = createdBatches.find((b) => b.batchIndex === 0);
  if (firstBatch) {
    await invokeTilingBatchLambda(firstBatch.batchId);
    console.log('Invoked first batch to start sequential chain', { batchId: firstBatch.batchId });
  }

  // Only pre-tile when this is a workflow launch (annotationSetId present).
  // For tiling-only operations, monitorTilingTasks owns the status transition.
  if (payload.annotationSetId) {
    const baseIds = tiledRequest.images.map((i) => i.id);
    const pretileImageIds =
      payload.launchImageIds && payload.launchImageIds.length > 0
        ? baseIds.filter((id) => payload.launchImageIds!.includes(id))
        : baseIds;

    if (pretileImageIds.length > 0) {
      if (!env.PRETILE_QUEUE_URL) {
        throw new Error('PRETILE_QUEUE_URL not set');
      }
      if (!env.REFRESH_TILES_QUEUE_URL) {
        throw new Error('REFRESH_TILES_QUEUE_URL not set');
      }
      const pretileBucketName = env.OUTPUTS_BUCKET_NAME;
      if (!pretileBucketName) {
        throw new Error('OUTPUTS_BUCKET_NAME not set');
      }
      await enqueuePretile({
        projectId: payload.projectId,
        annotationSetId: payload.annotationSetId,
        workflow: 'species-labelling',
        imageIds: Array.from(new Set(pretileImageIds)),
        executeGraphql,
        outputsBucket: pretileBucketName,
        queueUrl: env.PRETILE_QUEUE_URL,
        refreshQueueUrl: env.REFRESH_TILES_QUEUE_URL,
        sqsClient,
        s3Client,
      });
    }
  }

  console.log('Distributed tiling initiated', {
    tilingTaskId,
    totalBatches: batches.length,
    totalLocations: locations.length,
  });

  return {
    message: 'Distributed tiling initiated',
    tilingTaskId,
    locationSetId,
    totalBatches: batches.length,
    totalLocations: locations.length,
  };
}

// Generate all tile locations in memory without writing to DB
function generateTiledLocations(
  projectId: string,
  locationSetId: string,
  tiledRequest: TiledLaunchRequest
): LocationInput[] {
  const locations: LocationInput[] = [];

  const baselineWidth = Math.max(0, tiledRequest.maxX - tiledRequest.minX);
  const baselineHeight = Math.max(0, tiledRequest.maxY - tiledRequest.minY);
  const baselineIsLandscape = baselineWidth >= baselineHeight;

  for (const image of tiledRequest.images) {
    const imageIsLandscape = image.width >= image.height;
    const swapTileForImage = baselineIsLandscape !== imageIsLandscape;
    const tileWidthForImage = swapTileForImage
      ? tiledRequest.height
      : tiledRequest.width;
    const tileHeightForImage = swapTileForImage
      ? tiledRequest.width
      : tiledRequest.height;
    const horizontalTilesForImage = swapTileForImage
      ? tiledRequest.verticalTiles
      : tiledRequest.horizontalTiles;
    const verticalTilesForImage = swapTileForImage
      ? tiledRequest.horizontalTiles
      : tiledRequest.verticalTiles;
    const roiMinXForImage = swapTileForImage
      ? tiledRequest.minY
      : tiledRequest.minX;
    const roiMinYForImage = swapTileForImage
      ? tiledRequest.minX
      : tiledRequest.minY;
    const roiMaxXForImage = swapTileForImage
      ? tiledRequest.maxY
      : tiledRequest.maxX;
    const roiMaxYForImage = swapTileForImage
      ? tiledRequest.maxX
      : tiledRequest.maxY;

    const effectiveW = Math.max(0, roiMaxXForImage - roiMinXForImage);
    const effectiveH = Math.max(0, roiMaxYForImage - roiMinYForImage);
    const xStepSize =
      horizontalTilesForImage > 1
        ? (effectiveW - tileWidthForImage) / (horizontalTilesForImage - 1)
        : 0;
    const yStepSize =
      verticalTilesForImage > 1
        ? (effectiveH - tileHeightForImage) / (verticalTilesForImage - 1)
        : 0;

    for (let xStep = 0; xStep < horizontalTilesForImage; xStep++) {
      for (let yStep = 0; yStep < verticalTilesForImage; yStep++) {
        const x = Math.round(
          roiMinXForImage +
          (horizontalTilesForImage > 1 ? xStep * xStepSize : 0) +
          tileWidthForImage / 2
        );
        const y = Math.round(
          roiMinYForImage +
          (verticalTilesForImage > 1 ? yStep * yStepSize : 0) +
          tileHeightForImage / 2
        );

        locations.push({
          x,
          y,
          width: tileWidthForImage,
          height: tileHeightForImage,
          imageId: image.id,
          projectId,
          setId: locationSetId,
        });
      }
    }
  }

  return locations;
}

// Batch locations into groups
function batchLocations(
  locations: LocationInput[],
  batchSize: number
): LocationInput[][] {
  const batches: LocationInput[][] = [];
  for (let i = 0; i < locations.length; i += batchSize) {
    batches.push(locations.slice(i, i + batchSize));
  }
  return batches;
}

// Write a batch of locations to S3
async function writeBatchToS3(
  key: string,
  locations: LocationInput[]
): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(locations),
      ContentType: 'application/json',
    })
  );
}

// Invoke the processTilingBatch lambda
async function invokeTilingBatchLambda(batchId: string): Promise<void> {
  const functionName = env.PROCESS_TILING_BATCH_FUNCTION_NAME;
  if (!functionName) {
    throw new Error(
      'PROCESS_TILING_BATCH_FUNCTION_NAME environment variable not set'
    );
  }

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event', // Async invocation
      Payload: JSON.stringify({ batchId }),
    })
  );
}

// Clear all existing locations from a location set
async function clearLocationSetLocations(locationSetId: string): Promise<void> {
  console.log('Clearing existing locations from location set', {
    locationSetId,
  });

  // Type for the query response
  type LocationQueryResponse = {
    locationsBySetIdAndConfidence?: {
      items: Array<{ id: string }>;
      nextToken?: string | null;
    };
  };

  // Query all locations in the set using pagination
  let nextToken: string | null | undefined = undefined;
  let totalDeleted = 0;
  const deleteLimit = pLimit(50); // Limit concurrent deletions

  do {
    const response: LocationQueryResponse =
      await executeGraphql<LocationQueryResponse>(
        locationsBySetIdAndConfidence,
        {
          setId: locationSetId,
          confidence: { between: [0, 2] }, // Get all confidence levels
          limit: 10000,
          nextToken,
        }
      );

    const items: Array<{ id: string }> =
      response.locationsBySetIdAndConfidence?.items ?? [];
    nextToken = response.locationsBySetIdAndConfidence?.nextToken ?? null;

    if (items.length === 0) {
      break;
    }

    // Delete locations in parallel with concurrency limit
    const deleteTasks = items.map((item: { id: string }) =>
      deleteLimit(async () => {
        try {
          await executeGraphql<{ deleteLocation?: { id: string } }>(
            deleteLocationMutation,
            { input: { id: item.id } }
          );
        } catch (err) {
          console.warn('Failed to delete location', {
            id: item.id,
            error: err,
          });
        }
      })
    );

    await Promise.all(deleteTasks);
    totalDeleted += items.length;
    console.log('Deleted locations batch', {
      deleted: items.length,
      totalDeleted,
    });
  } while (nextToken);

  console.log('Finished clearing location set', {
    locationSetId,
    totalDeleted,
  });

  // Update the location set count to 0
  await executeGraphql<{ updateLocationSet?: { id: string } }>(
    updateLocationSetMutation,
    {
      input: {
        id: locationSetId,
        locationCount: 0,
      },
    }
  );
}

// Ensure the resolver input is a stringified payload.
function parsePayload(request: unknown): LaunchLambdaPayload {
  if (typeof request !== 'string') {
    throw new Error('Launch payload is required');
  }
  const parsed = JSON.parse(request);
  // Allow a minimal payload with just payloadS3Key for S3-based large payloads.
  if (parsed?.payloadS3Key) {
    return parsed as LaunchLambdaPayload;
  }
  // For tiling-only operations (when tiledRequest is provided), annotationSetId is optional
  const isTilingOnly = !!parsed?.tiledRequest;
  if (!parsed?.projectId || !parsed?.queueOptions) {
    throw new Error('Launch payload missing required fields');
  }
  if (!isTilingOnly && !parsed?.annotationSetId) {
    throw new Error(
      'Launch payload missing annotationSetId (required for non-tiling operations)'
    );
  }
  return parsed as LaunchLambdaPayload;
}

// Read the full payload from S3 when it exceeds inline limits.
async function readPayloadFromS3(key: string): Promise<LaunchLambdaPayload> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
  const bodyStr = await response.Body?.transformToString();
  if (!bodyStr) {
    throw new Error('Empty payload from S3');
  }
  const parsed = JSON.parse(bodyStr);
  // For tiling-only operations (when tiledRequest is provided), annotationSetId is optional
  const isTilingOnly = !!parsed?.tiledRequest;
  if (!parsed?.projectId || !parsed?.queueOptions) {
    throw new Error('S3 payload missing required fields');
  }
  if (!isTilingOnly && !parsed?.annotationSetId) {
    throw new Error(
      'S3 payload missing annotationSetId (required for non-tiling operations)'
    );
  }
  return parsed as LaunchLambdaPayload;
}

// Delete the payload file from S3 after processing.
async function deletePayloadFromS3(key: string): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    console.warn('OUTPUTS_BUCKET_NAME not set, cannot delete payload');
    return;
  }
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
  console.log('Deleted S3 payload', { key });
}

// Create an SQS queue plus the matching AppSync metadata row.
async function createQueue(
  queueOptions: LaunchQueueOptions,
  payload: LaunchLambdaPayload,
  locationIds: string[],
  locationSetId?: string,
  locationManifestS3Key?: string | null,
  launchedCount?: number | null,
  organizationId?: string
): Promise<QueueRecord> {
  const queueNameSeed = `${queueOptions.name}-${randomUUID()}`;
  const safeBaseName = makeSafeQueueName(queueNameSeed);
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

  // Generate a unique ID for the queue record before creating it
  const queueId = randomUUID();

  // Use manifest provided by client if available
  const manifestKey = locationManifestS3Key || null;
  const finalLaunchedCount = launchedCount ?? locationIds.length;

  if (manifestKey) {
    console.log('Using provided location manifest', { manifestKey, locationCount: finalLaunchedCount });
  }

  const timestamp = new Date().toISOString();

  const queueData = await executeGraphql<{
    createQueue?: { id: string };
  }>(createQueueMutation, {
    input: {
      id: queueId,
      url: queueUrl,
      name: queueOptions.name,
      projectId: payload.projectId,
      batchSize: payload.batchSize,
      hidden: queueOptions.hidden,
      zoom: payload.zoom ?? undefined,
      tag: payload.taskTag,
      approximateSize: 1,
      updatedAt: timestamp,
      requeueAt: timestamp,
      // New fields for requeue detection
      annotationSetId: payload.annotationSetId,
      locationSetId: locationSetId,
      launchedCount: finalLaunchedCount,
      observedCount: 0,
      locationManifestS3Key: manifestKey,
      requeuesCompleted: 0,
      group: organizationId,
    },
  });

  const createdQueue = queueData.createQueue;
  if (!createdQueue?.id) {
    throw new Error('Failed to record queue metadata');
  }

  return {
    id: createdQueue.id,
    url: queueUrl,
  };
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

// writeLocationManifest removed - now handled by client or tiling task monitor

// Batch SQS writes so we stay within SDK limits.
async function enqueueLocations(
  queueUrl: string,
  queueId: string,
  locationIds: string[],
  payload: LaunchLambdaPayload
) {
  const queueType = await getQueueType(queueUrl);
  const groupId = randomUUID();
  const batchSize = 10;
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];
  console.log('Dispatching SQS batches', {
    queueUrl,
    queueId,
    batches: Math.ceil(locationIds.length / batchSize),
  });

  for (let i = 0; i < locationIds.length; i += batchSize) {
    const locationBatch = locationIds.slice(i, i + batchSize);
    const entries = locationBatch.map((locationId) => {
      const messageBody = JSON.stringify({
        location: {
          id: locationId,
          annotationSetId: payload.annotationSetId,
        },
        queueId, // Include queueId for observation counter increment
        allowOutside: payload.allowOutside,
        taskTag: payload.taskTag,
        skipLocationWithAnnotations: payload.skipLocationWithAnnotations,
      });

      if (queueType === 'FIFO') {
        return {
          Id: `msg-${locationId}`,
          MessageBody: messageBody,
          MessageGroupId: groupId,
          MessageDeduplicationId: messageBody
            .replace(/[^a-zA-Z0-9\-_\.]/g, '')
            .substring(0, 128),
        };
      }

      return {
        Id: `msg-${locationId}`,
        MessageBody: messageBody,
      };
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
}

// Detect whether the target queue expects FIFO semantics.
async function getQueueType(queueUrl: string): Promise<'FIFO' | 'Standard'> {
  try {
    const attributes = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['All'],
      })
    );
    if (attributes.Attributes?.FifoQueue === 'true') {
      return 'FIFO';
    }
    return 'Standard';
  } catch (error) {
    console.warn(
      'Unable to determine queue type, defaulting to Standard',
      error
    );
    return 'Standard';
  }
}

// Shared GraphQL helper that surfaces descriptive errors.
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

// Normalize queue names to AWS-friendly characters/length.
function makeSafeQueueName(input: string): string {
  let sanitized = input.replace(/[^a-zA-Z0-9-_]/g, '_');
  const maxMainLength = 75;
  if (sanitized.length > maxMainLength) {
    sanitized = sanitized.substring(0, maxMainLength);
  }
  return sanitized;
}

// Flip project status in AppSync so the UI reflects progress.
async function setProjectStatus(
  projectId: string,
  status: string,
  condition?: { status: { eq: string } }
) {
  await executeGraphql<{ updateProject?: { id: string } }>(
    updateProjectMutation,
    {
      input: {
        id: projectId,
        status,
      },
      ...(condition ? { condition } : {}),
    }
  );
}

// Delete false negative annotations and observations using GraphQL
async function deleteFalseNegativeData(annotationSetId: string): Promise<void> {
  // Delete false negative observations
  await deleteFalseNegativeObservations(annotationSetId);

  // Delete false negative annotations
  await deleteFalseNegativeAnnotations(annotationSetId);

  // Delete the FN manifest from S3 (for continuation detection)
  await deleteFnManifest(annotationSetId);
}

// Delete all false-negative data across every annotation set in a project.
// Called when tiles are regenerated, since FN pools reference old tile geometries.
async function deleteFalseNegativeDataForProject(
  projectId: string
): Promise<void> {
  console.log('Deleting FN data for all annotation sets in project', {
    projectId,
  });

  type AnnotationSetsResponse = {
    annotationSetsByProjectId?: {
      items?: Array<{ id?: string | null }>;
      nextToken?: string | null;
    };
  };

  let nextToken: string | null | undefined = undefined;
  const annotationSetIds: string[] = [];

  do {
    const response: AnnotationSetsResponse =
      await executeGraphql<AnnotationSetsResponse>(
        annotationSetsByProjectIdQuery,
        {
          projectId,
          limit: 100,
          nextToken,
        }
      );

    const page = response.annotationSetsByProjectId;
    for (const item of page?.items || []) {
      if (item?.id) annotationSetIds.push(item.id);
    }
    nextToken = page?.nextToken ?? undefined;
  } while (nextToken);

  if (annotationSetIds.length === 0) {
    console.log('No annotation sets found, nothing to clean');
    return;
  }

  console.log('Found annotation sets to clean FN data', {
    count: annotationSetIds.length,
  });

  for (const annotationSetId of annotationSetIds) {
    await deleteFalseNegativeData(annotationSetId);
  }

  console.log('Finished deleting FN data for project', {
    projectId,
    annotationSetsCleaned: annotationSetIds.length,
  });
}

// Delete all FN manifests from S3 when FN data is being cleared.
// This covers both the legacy single manifest and the new pool/history manifests.
async function deleteFnManifest(annotationSetId: string): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    console.warn('OUTPUTS_BUCKET_NAME not set, cannot delete FN manifests');
    return;
  }
  const keys = [
    `false-negative-manifests/${annotationSetId}.json`,
    `false-negative-pools/${annotationSetId}.json`,
    `false-negative-history/${annotationSetId}.json`,
  ];
  for (const key of keys) {
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: key,
        })
      );
      console.log('Deleted FN manifest from S3', { key });
    } catch (error: any) {
      if (error?.name === 'NoSuchKey' || error?.Code === 'NoSuchKey') {
        console.log('FN manifest does not exist, nothing to delete', { key });
        continue;
      }
      console.warn('Failed to delete FN manifest', { key, error });
    }
  }
}

// Delete observations with source containing 'false-negative'
async function deleteFalseNegativeObservations(
  annotationSetId: string
): Promise<void> {
  console.log('Querying false negative observations', { annotationSetId });

  let nextToken: string | null | undefined = undefined;
  let totalFetched = 0;
  let totalDeleted = 0;
  const deleteLimit = pLimit(50);

  do {
    // Query observations using the index with source filter
    const response = (await client.graphql({
      query: observationsByAnnotationSetId,
      variables: {
        annotationSetId,
        filter: {
          source: { contains: 'false-negative' },
        },
        limit: 10000,
        nextToken,
      },
    })) as GraphQLResult<{
      observationsByAnnotationSetId?: {
        items?: Array<{
          id?: string | null;
          source?: string | null;
        }>;
        nextToken?: string | null;
      };
    }>;

    if (response.errors && response.errors.length > 0) {
      throw new Error(
        `GraphQL error fetching observations: ${JSON.stringify(
          response.errors.map((e) => e.message)
        )}`
      );
    }

    const page = response.data?.observationsByAnnotationSetId;
    const items = page?.items ?? [];
    nextToken = page?.nextToken ?? null;

    totalFetched += items.length;

    if (items.length === 0) {
      break;
    }

    // Delete each item using GraphQL mutation
    const deleteTasks = items.map((item) =>
      deleteLimit(async () => {
        if (!item?.id) return;
        try {
          await executeGraphql<{ deleteObservation?: { id: string } }>(
            deleteObservationMutation,
            { input: { id: item.id } }
          );
        } catch (err) {
          console.warn('Failed to delete observation', {
            id: item.id,
            error: err,
          });
        }
      })
    );

    await Promise.all(deleteTasks);
    totalDeleted += items.length;
    console.log('Deleted observations batch', {
      deleted: items.length,
      totalDeleted,
    });
  } while (nextToken);

  console.log('Finished deleting false negative observations', {
    totalFetched,
    totalDeleted,
  });
}

// Delete annotations with source containing 'false-negative'
async function deleteFalseNegativeAnnotations(
  annotationSetId: string
): Promise<void> {
  console.log('Querying false negative annotations', { annotationSetId });

  let nextToken: string | null | undefined = undefined;
  let totalFetched = 0;
  let totalDeleted = 0;
  const deleteLimit = pLimit(50);

  do {
    // Query annotations using the index with source filter
    const response = (await client.graphql({
      query: annotationsByAnnotationSetId,
      variables: {
        setId: annotationSetId,
        filter: {
          source: { contains: 'false-negative' },
        },
        limit: 10000,
        nextToken,
      },
    })) as GraphQLResult<{
      annotationsByAnnotationSetId?: {
        items?: Array<{
          id?: string | null;
          source?: string | null;
        }>;
        nextToken?: string | null;
      };
    }>;

    if (response.errors && response.errors.length > 0) {
      throw new Error(
        `GraphQL error fetching annotations: ${JSON.stringify(
          response.errors.map((e) => e.message)
        )}`
      );
    }

    const page = response.data?.annotationsByAnnotationSetId;
    const items = page?.items ?? [];
    nextToken = page?.nextToken ?? null;

    totalFetched += items.length;

    if (items.length === 0) {
      break;
    }

    // Delete each item using GraphQL mutation
    const deleteTasks = items.map((item) =>
      deleteLimit(async () => {
        if (!item?.id) return;
        try {
          await executeGraphql<{ deleteAnnotation?: { id: string } }>(
            deleteAnnotationMutation,
            { input: { id: item.id } }
          );
        } catch (err) {
          console.warn('Failed to delete annotation', {
            id: item.id,
            error: err,
          });
        }
      })
    );

    await Promise.all(deleteTasks);
    totalDeleted += items.length;
    console.log('Deleted annotations batch', {
      deleted: items.length,
      totalDeleted,
    });
  } while (nextToken);

  console.log('Finished deleting false negative annotations', {
    totalFetched,
    totalDeleted,
  });
}
