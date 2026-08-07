import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/monitorTilingTasks';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
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
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { createShadowWorkflowRun } from '../workflowStats/runWriter';
import {
  tilingTasksByStatus,
  tilingBatchesByTaskId,
} from './graphql/queries';

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

const createTasksOnAnnotationSetMutation = /* GraphQL */ `
  mutation CreateTasksOnAnnotationSet($input: CreateTasksOnAnnotationSetInput!) {
    createTasksOnAnnotationSet(input: $input) { id group }
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

const updateTilingTaskMutation = /* GraphQL */ `
  mutation UpdateTilingTask($input: UpdateTilingTaskInput!) {
    updateTilingTask(input: $input) { id group }
  }
`;

const queuesByProjectIdQuery = /* GraphQL */ `
  query QueuesByProjectId($projectId: ID!, $limit: Int) {
    queuesByProjectId(projectId: $projectId, limit: $limit) {
      items { id }
    }
  }
`;

// Configure Amplify for IAM-based GraphQL access.
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

const client = generateClient({
  authMode: 'iam',
});

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

// Launch config stored in TilingTask
type LaunchConfig = {
  queueOptions: {
    name: string;
    hidden: boolean;
    fifo: boolean;
  };
  allowOutside: boolean;
  skipLocationWithAnnotations: boolean;
  taskTag: string;
  batchSize: number;
  zoom?: number | null;
  // False negatives specific fields
  isFalseNegatives?: boolean;
  samplePercent?: number;
  launchImageIds?: string[];
  launchedBy?: string;
};

type TilingTaskRecord = {
  id: string;
  projectId: string;
  locationSetId: string;
  annotationSetId: string;
  status: string;
  launchConfig: string;
  totalBatches: number;
  completedBatches: number;
  totalLocations: number;
};

type TilingBatchRecord = {
  id: string;
  tilingTaskId: string;
  batchIndex: number;
  status: string;
  outputS3Key?: string | null;
  createdCount: number;
};

type QueueRecord = {
  id: string;
  url: string;
};

// Entry point invoked by EventBridge schedule.
export const handler: Handler = async () => {
  console.log('monitorTilingTasks invoked');

  try {
    // Find all processing tiling tasks
    const processingTasks = await fetchProcessingTasks();
    console.log('Found processing tasks', { count: processingTasks.length });

    for (const task of processingTasks) {
      await processTask(task);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Tiling tasks monitored',
        tasksChecked: processingTasks.length,
      }),
    };
  } catch (error: any) {
    console.error('Error monitoring tiling tasks', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to monitor tiling tasks',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

async function processTask(task: TilingTaskRecord) {
  console.log('Processing task', { taskId: task.id, projectId: task.projectId });

  try {
    // Fetch all batches for this task
    const batches = await fetchBatchesForTask(task.id);
    console.log('Fetched batches', {
      taskId: task.id,
      batchCount: batches.length,
      totalBatches: task.totalBatches,
    });

    // Check if all batches are complete
    const completedBatches = batches.filter((b) => b.status === 'completed');
    const failedBatches = batches.filter((b) => b.status === 'failed');

    if (failedBatches.length > 0) {
      console.error('Task has failed batches', {
        taskId: task.id,
        failedCount: failedBatches.length,
      });
      await updateTaskFailed(
        task.id,
        `${failedBatches.length} batches failed`
      );
      await setProjectStatus(task.projectId, 'active');
      return;
    }

    if (completedBatches.length < task.totalBatches) {
      console.log('Task not yet complete', {
        taskId: task.id,
        completedBatches: completedBatches.length,
        totalBatches: task.totalBatches,
      });
      // Update completedBatches count
      await executeGraphql<{ updateTilingTask?: { id: string } }>(
        updateTilingTaskMutation,
        {
          input: {
            id: task.id,
            completedBatches: completedBatches.length,
          },
        }
      );
      return;
    }

    // All batches complete
    console.log('All batches complete', { taskId: task.id });

    // Check if this is a tiling-only operation (no annotation set launch needed)
    const isTilingOnly = task.annotationSetId === 'tiling-only';

    if (isTilingOnly) {
      // Tiling-only mode: just clean up and mark complete, no queue creation
      console.log('Tiling-only operation complete, skipping queue creation', { taskId: task.id });

      // Update project status
      await setProjectStatus(task.projectId, 'active');

      // Refresh project memberships to notify clients of status change
      await executeGraphql<{ updateProjectMemberships?: string | null }>(
        updateProjectMembershipsMutation,
        { projectId: task.projectId }
      );

      // Clean up S3 files
      await cleanupBatchOutputs(completedBatches);
      console.log('Cleaned up batch outputs', { taskId: task.id });

      // Mark task as completed
      await updateTaskCompleted(task.id);
      console.log('Tiling-only task completed successfully', { taskId: task.id });
      return;
    }

    // Fetch organizationId from the project for group-based access
    const projectData = await executeGraphql<{
      getProject?: { organizationId: string };
    }>(getProjectOrganizationId, { id: task.projectId });
    const organizationId = projectData.getProject?.organizationId;
    if (!organizationId) {
      throw new Error(`Project ${task.projectId} missing organizationId`);
    }

    // Download and merge all locations from batch outputs
    const allLocations = await mergeLocations(completedBatches);
    console.log('Merged locations', {
      taskId: task.id,
      totalLocations: allLocations.length,
    });

    const allLocationIds = allLocations.map(l => l.locationId);

    // Parse launch config
    const launchConfig = JSON.parse(task.launchConfig) as LaunchConfig;

    let finalLocationIds = allLocationIds;

    // Filter by launchImageIds if provided (dev only feature)
    if (launchConfig.launchImageIds && launchConfig.launchImageIds.length > 0) {
      const allowedImageIds = new Set(launchConfig.launchImageIds);
      console.log('Filtering locations by image IDs', {
        total: allLocations.length,
        allowedCount: allowedImageIds.size
      });

      // We need to map back to image IDs. 
      // The merged locations (allLocations) are raw objects from the tiling batch output.
      // They should contain imageId.
      const filteredLocations = allLocations.filter(l => allowedImageIds.has(l.imageId));
      finalLocationIds = filteredLocations.map(l => l.locationId);

      console.log('Filtered locations result', {
        originalCount: allLocationIds.length,
        filteredCount: finalLocationIds.length
      });
    }

    // For false negatives, filtering was already done before batching in launchFalseNegatives
    // Just use the merged location IDs directly (or the filtered ones if applicable)
    if (launchConfig.isFalseNegatives) {
      console.log('False negatives filtering already done before batching', {
        taskId: task.id,
        locationCount: allLocationIds.length,
      });

      if (allLocationIds.length === 0) {
        // No candidates found, mark as complete and skip queue creation
        await setProjectStatus(task.projectId, 'active');
        await cleanupBatchOutputs(completedBatches);
        await updateTaskCompleted(task.id);
        console.log('No false-negative candidates found, task completed without queue', { taskId: task.id });
        return;
      }
    }

    // Guard: prevent duplicate queues for the same project and tag
    const existingQueue = await findExistingQueue(task.projectId);
    if (existingQueue) {
      console.warn('Duplicate queue launch blocked', {
        projectId: task.projectId,
        existingQueueId: existingQueue.id,
        taskId: task.id,
      });
      await setProjectStatus(task.projectId, 'active');
      await cleanupBatchOutputs(completedBatches);
      await updateTaskCompleted(task.id);
      return;
    }

    // Create queue and enqueue locations
    const mainQueue = await createQueue(
      launchConfig.queueOptions,
      task.projectId,
      launchConfig,
      task.annotationSetId,
      task.locationSetId,
      allLocations,
      organizationId
    );
    await createShadowWorkflowRun(
      {
        runId: mainQueue.id,
        workflowType: launchConfig.isFalseNegatives
          ? 'false-negatives'
          : 'species-labelling',
        projectId: task.projectId,
        annotationSetId: task.annotationSetId,
        displayName: launchConfig.queueOptions.name,
        configuration: {
          locationSetId: task.locationSetId,
          tilingTaskId: task.id,
          taskTag: launchConfig.taskTag,
          batchSize: launchConfig.batchSize,
          launchedCount: finalLocationIds.length,
          samplePercent: launchConfig.samplePercent,
        },
      },
      {
        userId: launchConfig.launchedBy ?? 'system',
        organizationId,
      }
    );
    await enqueueLocations(
      mainQueue.url,
      mainQueue.id,
      finalLocationIds,
      task.annotationSetId,
      launchConfig
    );
    console.log('Enqueued locations', {
      taskId: task.id,
      queueId: mainQueue.id,
      count: finalLocationIds.length,
    });

    // Update queue total batches
    await executeGraphql<{ updateQueue?: { id: string } }>(updateQueueMutation, {
      input: {
        id: mainQueue.id,
        totalBatches: Math.ceil(finalLocationIds.length / launchConfig.batchSize),
      },
    });

    // Create tasks on annotation set
    await executeGraphql<{ createTasksOnAnnotationSet?: { id: string } }>(
      createTasksOnAnnotationSetMutation,
      {
        input: {
          annotationSetId: task.annotationSetId,
          locationSetId: task.locationSetId,
          group: organizationId,
        },
      }
    );

    // Update project status
    await setProjectStatus(task.projectId, 'active');

    // Refresh project memberships
    await executeGraphql<{ updateProjectMemberships?: string | null }>(
      updateProjectMembershipsMutation,
      { projectId: task.projectId }
    );

    // Clean up S3 files
    await cleanupBatchOutputs(completedBatches);
    console.log('Cleaned up batch outputs', { taskId: task.id });

    // Mark task as completed
    await updateTaskCompleted(task.id);
    console.log('Task completed successfully', { taskId: task.id });
  } catch (error: any) {
    const errorMessage = error?.message ?? (typeof error === 'string' ? error : JSON.stringify(error));
    console.error('Error processing task', {
      taskId: task.id,
      error: errorMessage,
      stack: error?.stack,
    });
    await updateTaskFailed(task.id, errorMessage ?? 'Unknown error');
    await setProjectStatus(task.projectId, 'active');
  }
}

async function fetchProcessingTasks(): Promise<TilingTaskRecord[]> {
  const tasks: TilingTaskRecord[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const response = (await client.graphql({
      query: tilingTasksByStatus,
      variables: {
        status: 'processing',
        limit: 100,
        nextToken,
      },
    } as any)) as GraphQLResult<{
      tilingTasksByStatus?: {
        items?: Array<TilingTaskRecord>;
        nextToken?: string | null;
      };
    }>;

    if (response.errors && response.errors.length > 0) {
      throw new Error(
        `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
      );
    }

    const page = response.data?.tilingTasksByStatus;
    for (const item of page?.items || []) {
      if (item) {
        tasks.push(item);
      }
    }
    nextToken = page?.nextToken ?? undefined;
  } while (nextToken);

  return tasks;
}

async function fetchBatchesForTask(taskId: string): Promise<TilingBatchRecord[]> {
  const batches: TilingBatchRecord[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const response = (await client.graphql({
      query: tilingBatchesByTaskId,
      variables: {
        tilingTaskId: taskId,
        limit: 10000,
        nextToken,
      },
    } as any)) as GraphQLResult<{
      tilingBatchesByTaskId?: {
        items?: Array<TilingBatchRecord>;
        nextToken?: string | null;
      };
    }>;

    if (response.errors && response.errors.length > 0) {
      throw new Error(
        `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
      );
    }

    const page = response.data?.tilingBatchesByTaskId;
    for (const item of page?.items || []) {
      if (item) {
        batches.push(item);
      }
    }
    nextToken = page?.nextToken ?? undefined;
  } while (nextToken);

  return batches;
}

async function mergeLocations(batches: TilingBatchRecord[]): Promise<any[]> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }

  const allLocations: any[] = [];
  const limit = pLimit(10);

  const downloadTasks = batches.map((batch) =>
    limit(async () => {
      if (!batch.outputS3Key) {
        console.warn('Batch missing output S3 key', { batchId: batch.id });
        return [];
      }

      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: batch.outputS3Key,
        })
      );

      const bodyStr = await response.Body?.transformToString();
      if (!bodyStr) {
        console.warn('Empty output file', { batchId: batch.id });
        return [];
      }

      return JSON.parse(bodyStr) as any[];
    })
  );

  const results = await Promise.all(downloadTasks);
  for (const locations of results) {
    allLocations.push(...locations);
  }

  return allLocations;
}

async function cleanupBatchOutputs(batches: TilingBatchRecord[]): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    console.warn('OUTPUTS_BUCKET_NAME not set, cannot cleanup');
    return;
  }

  const limit = pLimit(10);
  const deleteTasks = batches
    .filter((b) => b.outputS3Key)
    .map((batch) =>
      limit(async () => {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: bucketName,
            Key: batch.outputS3Key!,
          })
        );
      })
    );

  await Promise.all(deleteTasks);
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

async function createQueue(
  queueOptions: { name: string; hidden: boolean; fifo: boolean },
  projectId: string,
  launchConfig: LaunchConfig,
  annotationSetId: string,
  locationSetId: string,
  locations: any[],
  group: string
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

  // Write S3 manifest with all location info for requeue detection
  const manifestKey = `queue-manifests/${queueId}.json`;
  await writeLocationManifest(manifestKey, locations);
  console.log('Wrote location manifest to S3', { manifestKey, locationCount: locations.length });

  const timestamp = new Date().toISOString();

  const queueData = await executeGraphql<{
    createQueue?: { id: string };
  }>(createQueueMutation, {
    input: {
      id: queueId,
      url: queueUrl,
      name: queueOptions.name,
      projectId,
      batchSize: launchConfig.batchSize,
      hidden: queueOptions.hidden,
      zoom: launchConfig.zoom ?? undefined,
      tag: launchConfig.taskTag,
      approximateSize: 1,
      updatedAt: timestamp,
      requeueAt: timestamp,
      // New fields for requeue detection
      annotationSetId,
      locationSetId,
      launchedCount: locations.length,
      observedCount: 0,
      locationManifestS3Key: manifestKey,
      requeuesCompleted: 0,
      group,
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

// Write location info to S3 manifest for requeue detection
async function writeLocationManifest(key: string, locations: any[]): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify({ items: locations }),
      ContentType: 'application/json',
    })
  );
}

async function enqueueLocations(
  queueUrl: string,
  queueId: string,
  locationIds: string[],
  annotationSetId: string,
  launchConfig: LaunchConfig
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
          annotationSetId,
        },
        queueId, // Include queueId for observation counter increment
        allowOutside: launchConfig.allowOutside,
        taskTag: launchConfig.taskTag,
        skipLocationWithAnnotations: launchConfig.skipLocationWithAnnotations,
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
    console.warn('Unable to determine queue type, defaulting to Standard', error);
    return 'Standard';
  }
}

function makeSafeQueueName(input: string): string {
  let sanitized = input.replace(/[^a-zA-Z0-9-_]/g, '_');
  const maxMainLength = 75;
  if (sanitized.length > maxMainLength) {
    sanitized = sanitized.substring(0, maxMainLength);
  }
  return sanitized;
}

async function setProjectStatus(projectId: string, status: string) {
  await executeGraphql<{ updateProject?: { id: string } }>(
    updateProjectMutation,
    {
      input: {
        id: projectId,
        status,
      },
    }
  );
}

async function updateTaskCompleted(taskId: string): Promise<void> {
  await executeGraphql<{ updateTilingTask?: { id: string } }>(
    updateTilingTaskMutation,
    {
      input: {
        id: taskId,
        status: 'completed',
      },
    }
  );
}

async function updateTaskFailed(taskId: string, errorMessage: string): Promise<void> {
  await executeGraphql<{ updateTilingTask?: { id: string } }>(
    updateTilingTaskMutation,
    {
      input: {
        id: taskId,
        status: 'failed',
        errorMessage,
      },
    }
  );
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

  if (!response.data) {
    throw new Error('GraphQL response missing data');
  }

  return response.data;
}
