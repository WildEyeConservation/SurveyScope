import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/findAndRequeueMissingLocations';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  SQSClient,
  SendMessageBatchCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createSampleStore } from '../falseNegativeSamples/store';
import {
  listQueues,
  observationsByAnnotationSetId,
  annotationsByImageIdAndSetId,
  getProject,
} from './graphql/queries';

// Inline minimal mutations – return key fields + `group` to avoid nested-resolver
// auth failures while still enabling subscription delivery via groupDefinedIn('group').
const updateQueue = /* GraphQL */ `
  mutation UpdateQueue($input: UpdateQueueInput!) {
    updateQueue(input: $input) { id group }
  }
`;

const createAdminActionLog = /* GraphQL */ `
  mutation CreateAdminActionLog($input: CreateAdminActionLogInput!) {
    createAdminActionLog(input: $input) { id group }
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

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

const sampleDb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: env.AWS_REGION })
);

const sqsClient = new SQSClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

// Constants
const EMPTY_QUEUE_WAIT_MINUTES = 10;
const MAX_REQUEUES = 1;

type QueueRecord = {
  id: string;
  projectId: string;
  name: string;
  url: string;
  tag?: string | null;
  approximateSize?: number | null;
  annotationSetId?: string | null;
  locationSetId?: string | null;
  launchedCount?: number | null;
  observedCount?: number | null;
  locationManifestS3Key?: string | null;
  emptyQueueTimestamp?: string | null;
  requeuesCompleted?: number | null;
};

type Location = {
  locationId: string;
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Annotation = {
  id: string;
  x: number;
  y: number;
};

type QCManifestItem = {
  annotationId: string;
  imageId: string;
};

type QCAnnotationForRequeue = {
  id: string;
  imageId: string;
  categoryId: string;
  setId: string;
  x: number;
  y: number;
};

type InfoTagManifestItem = {
  imageId: string;
  annotationIds: string[];
};

type InfoTagManifest = {
  categoryIds: string[];
  items: InfoTagManifestItem[];
};

// Entry point invoked by EventBridge schedule.
export const handler: Handler = async () => {
  console.log('findAndRequeueMissingLocations invoked');

  try {
    // Find candidate queues: empty SQS, may have missing locations
    const candidateQueues = await fetchCandidateQueues();
    console.log('Found candidate queues', { count: candidateQueues.length });

    let requeuedTotal = 0;
    for (const queue of candidateQueues) {
      const requeued = await processQueue(queue);
      requeuedTotal += requeued;
    }

    console.log('Requeue check complete', {
      queuesChecked: candidateQueues.length,
      locationsRequeued: requeuedTotal,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Requeue check complete',
        queuesChecked: candidateQueues.length,
        locationsRequeued: requeuedTotal,
      }),
    };
  } catch (error: any) {
    console.error('Error in findAndRequeueMissingLocations', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to check for missing locations',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

async function fetchCandidateQueues(): Promise<QueueRecord[]> {
  const queues: QueueRecord[] = [];
  let nextToken: string | null | undefined = undefined;

  do {
    const response = (await client.graphql({
      query: listQueues,
      variables: {
        limit: 100,
        nextToken,
      },
    } as any)) as GraphQLResult<{
      listQueues?: {
        items?: Array<QueueRecord | null>;
        nextToken?: string | null;
      };
    }>;

    if (response.errors && response.errors.length > 0) {
      throw new Error(
        `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
      );
    }

    const page = response.data?.listQueues;
    for (const item of page?.items || []) {
      if (item) {
        const isCandidate =
          item.approximateSize === 0 &&
          item.locationManifestS3Key &&
          item.launchedCount != null &&
          item.launchedCount > 0 &&
          item.observedCount != null &&
          item.observedCount < item.launchedCount &&
          (item.requeuesCompleted ?? 0) < MAX_REQUEUES;

        if (isCandidate) {
          console.log('Found candidate queue', {
            id: item.id,
            name: item.name,
            approximateSize: item.approximateSize,
            launchedCount: item.launchedCount,
            observedCount: item.observedCount,
            requeuesCompleted: item.requeuesCompleted,
          });
          queues.push(item);
        }
      }
    }
    nextToken = page?.nextToken ?? undefined;
  } while (nextToken);

  return queues;
}

async function processQueue(queue: QueueRecord): Promise<number> {
  console.log('Processing queue', {
    queueId: queue.id,
    name: queue.name,
    tag: queue.tag,
    launchedCount: queue.launchedCount,
    observedCount: queue.observedCount,
    requeuesCompleted: queue.requeuesCompleted,
  });

  const now = new Date();

  // Step 1: If emptyQueueTimestamp not set, set it and return
  if (!queue.emptyQueueTimestamp) {
    console.log('Setting emptyQueueTimestamp for queue', { queueId: queue.id });
    await executeGraphql(updateQueue, {
      input: {
        id: queue.id,
        emptyQueueTimestamp: now.toISOString(),
      },
    });
    return 0;
  }

  // Step 2: Check if empty for at least EMPTY_QUEUE_WAIT_MINUTES
  const emptyTimestamp = new Date(queue.emptyQueueTimestamp);
  const minutesEmpty = (now.getTime() - emptyTimestamp.getTime()) / (1000 * 60);

  if (minutesEmpty < EMPTY_QUEUE_WAIT_MINUTES) {
    console.log('Queue not empty long enough', {
      queueId: queue.id,
      minutesEmpty: minutesEmpty.toFixed(1),
      required: EMPTY_QUEUE_WAIT_MINUTES,
    });
    return 0;
  }

  // Step 3: Verify SQS is still empty (double-check)
  const sqsEmpty = await checkSqsEmpty(queue.url);
  if (!sqsEmpty) {
    console.log('SQS queue not empty, clearing emptyQueueTimestamp', { queueId: queue.id });
    await executeGraphql(updateQueue, {
      input: {
        id: queue.id,
        emptyQueueTimestamp: null,
      },
    });
    return 0;
  }

  // Branch for QC review queues — manifest format and completion check differ.
  if (queue.tag === 'qc-review') {
    return processQCRequeue(queue);
  }

  if (queue.tag === 'info-tags') {
    return processInfoTagRequeue(queue);
  }

  // Branch for homography queues — completion = real homography or skipped.
  if (queue.tag === 'homography') {
    return processHomographyRequeue(queue);
  }

  // Step 4: Download S3 manifest
  console.log('Downloading location manifest', { key: queue.locationManifestS3Key });
  const launchedLocations = await downloadManifest(queue.locationManifestS3Key!);
  const launchedLocationIds = launchedLocations.map((l) => l.locationId);
  console.log('Downloaded manifest', { locationCount: launchedLocations.length });

  // Step 5-6: Work out which launched locations still need a look
  const isFalseNegatives = queue.name === 'False Negatives';
  const missingLocationIds =
    (isFalseNegatives
      ? await pendingSampleTiles(queue.annotationSetId!, launchedLocationIds)
      : null) ??
    (await missingByObservations(queue, launchedLocations, launchedLocationIds));

  if (missingLocationIds.length === 0) {
    console.log('No missing locations, updating requeuesCompleted', { queueId: queue.id });
    await executeGraphql(updateQueue, {
      input: {
        id: queue.id,
        emptyQueueTimestamp: null,
        requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      },
    });
    return 0;
  }

  // Step 7: Requeue missing locations
  console.log('Requeuing missing locations', {
    queueId: queue.id,
    count: missingLocationIds.length,
  });

  // A false-negative tile is a sample of ground; marks must stay inside it.
  await requeueLocations(queue, missingLocationIds, !isFalseNegatives);

  // Step 8: Update queue record
  await executeGraphql(updateQueue, {
    input: {
      id: queue.id,
      emptyQueueTimestamp: null,
      requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      approximateSize: missingLocationIds.length,
    },
  });

  // Step 9: Log to AdminActionLog
  await logRequeueAction(queue, missingLocationIds.length);

  console.log('Requeue complete', {
    queueId: queue.id,
    requeuedCount: missingLocationIds.length,
    attemptNumber: (queue.requeuesCompleted ?? 0) + 1,
  });

  return missingLocationIds.length;
}

/** The sample's tiles that are still pending; null when the set has none. */
async function pendingSampleTiles(
  annotationSetId: string,
  launchedLocationIds: string[]
): Promise<string[] | null> {
  const table = process.env.FALSE_NEGATIVE_SAMPLES_TABLE;
  if (!table) return null;
  const samples = createSampleStore(sampleDb, table);
  if (!(await samples.getSummary(annotationSetId))) return null;
  const pending = new Set<string>();
  for await (const page of samples.rowPages(annotationSetId)) {
    for (const row of page) {
      if (row.status === 'pending') pending.add(row.tileId);
    }
  }
  const missing = launchedLocationIds.filter((id) => pending.has(id));
  console.log('Computed missing sample tiles', {
    annotationSetId,
    launched: launchedLocationIds.length,
    missingCount: missing.length,
  });
  return missing;
}

async function missingByObservations(
  queue: QueueRecord,
  launchedLocations: Location[],
  launchedLocationIds: string[]
): Promise<string[]> {
  console.log('Fetching observations', { annotationSetId: queue.annotationSetId });
  const observedLocationIds = await fetchObservedLocationIds(queue.annotationSetId!);
  console.log('Fetched observations result', {
    annotationSetId: queue.annotationSetId,
    observedCount: observedLocationIds.size,
  });

  // Some of the launched locations may have been annotated but not observed
  // Step 5.2: Query annotations to find annotated unobserved locations
  console.log('Fetching annotations', { annotationSetId: queue.annotationSetId });
  const unobservedLaunchedLocations = launchedLocations.filter((l) => !observedLocationIds.has(l.locationId));
  const annotatedUnobservedLocationIds = await fetchAnnotatedLocationIds(unobservedLaunchedLocations, queue.annotationSetId!);
  console.log('Fetched annotations result', {
    annotationSetId: queue.annotationSetId,
    annotatedCount: annotatedUnobservedLocationIds.size,
  });

  const missingLocationIds = launchedLocationIds.filter(
    (id) => !observedLocationIds.has(id) && !annotatedUnobservedLocationIds.has(id)
  );
  const observedFromLaunched = launchedLocationIds.filter((id) => observedLocationIds.has(id)).length;
  console.log('Computed missing locations', {
    queueId: queue.id,
    launched: launchedLocationIds.length,
    observedFromLaunched,
    observedTotal: observedLocationIds.size,
    annotated: annotatedUnobservedLocationIds.size,
    missingCount: missingLocationIds.length,
  });
  return missingLocationIds;
}

async function checkSqsEmpty(queueUrl: string): Promise<boolean> {
  try {
    const response = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      })
    );

    const visible = parseInt(response.Attributes?.ApproximateNumberOfMessages ?? '0');
    const notVisible = parseInt(response.Attributes?.ApproximateNumberOfMessagesNotVisible ?? '0');

    console.log('Checked SQS attributes', {
      queueUrl,
      visible,
      notVisible,
      isEmpty: visible === 0 && notVisible === 0,
    });

    return visible === 0 && notVisible === 0;
  } catch (error) {
    console.warn('Failed to check SQS attributes', error);
    // If we can't check, assume not empty to be safe
    return false;
  }
}

async function downloadManifest(key: string): Promise<Location[]> {
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

  const manifest = JSON.parse(bodyStr);
  return manifest.items as Location[];
}

async function fetchAnnotatedLocationIds(locations: Location[], annotationSetId: string): Promise<Set<string>> {
  // fetch and cache annotations by image
  const annotationsByImage = new Map<string, Annotation[]>();
  const limit = pLimit(50);
  const imageIds = Array.from(new Set(locations.map((l) => l.imageId)));

  console.log('Fetching annotations for images', {
    imageCount: imageIds.length,
    annotationSetId,
  });

  await Promise.all(
    imageIds.map((imageId) =>
      limit(async () => {
        let nextToken: string | undefined = undefined;
        let totalImageAnnotations = 0;
        do {
          const response = (await client.graphql({
            query: annotationsByImageIdAndSetId,
            variables: {
              imageId,
              setId: { eq: annotationSetId },
              limit: 10000,
              nextToken,
            },
          } as any)) as GraphQLResult<{
            annotationsByImageIdAndSetId?: {
              items?: Array<Annotation | null>;
              nextToken?: string | null;
            };
          }>;

          if (response.errors && response.errors.length > 0) {
            console.error('GraphQL error in fetchAnnotatedLocationIds', {
              imageId,
              annotationSetId,
              errors: response.errors,
            });
            throw new Error(
              `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
            );
          }

          const page = response.data?.annotationsByImageIdAndSetId;
          const items = (page?.items || []).filter((item): item is Annotation => !!item);
          if (items.length > 0) {
            let imageAnnotations = annotationsByImage.get(imageId);
            if (!imageAnnotations) {
              imageAnnotations = [];
              annotationsByImage.set(imageId, imageAnnotations);
            }
            imageAnnotations.push(...items);
            totalImageAnnotations += items.length;
          }
          nextToken = page?.nextToken ?? undefined;
        } while (nextToken);

        if (totalImageAnnotations > 0) {
          console.log(`Fetched ${totalImageAnnotations} annotations for image ${imageId}`);
        }
      })
    )
  );

  const annotatedIds = new Set<string>();

  for (const location of locations) {
    const boundsxy: [number, number][] = [
      [location.x - location.width / 2, location.y - location.height / 2],
      [location.x + location.width / 2, location.y + location.height / 2],
    ];

    const isWithinBounds = (annotation: Annotation) => {
      return annotation.x >= boundsxy[0][0] &&
        annotation.y >= boundsxy[0][1] &&
        annotation.x <= boundsxy[1][0] &&
        annotation.y <= boundsxy[1][1];
    };

    const imageAnnotations = annotationsByImage.get(location.imageId);
    if (imageAnnotations) {
      for (const annotation of imageAnnotations) {
        if (isWithinBounds(annotation)) {
          annotatedIds.add(location.locationId);
          break;
        }
      }
    }
  }

  return annotatedIds;
}

async function fetchObservedLocationIds(annotationSetId: string): Promise<Set<string>> {
  const observedIds = new Set<string>();
  let nextToken: string | null | undefined = undefined;
  let pageCount = 0;

  do {
    pageCount++;
    const response = (await client.graphql({
      query: observationsByAnnotationSetId,
      variables: {
        annotationSetId,
        limit: 10000,
        nextToken,
      },
    } as any)) as GraphQLResult<{
      observationsByAnnotationSetId?: {
        items?: Array<{ id: string; locationId: string } | null>;
        nextToken?: string | null;
      };
    }>;

    if (response.errors && response.errors.length > 0) {
      console.error('GraphQL error in fetchObservedLocationIds', {
        annotationSetId,
        errors: response.errors,
      });
      throw new Error(
        `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
      );
    }

    const page = response.data?.observationsByAnnotationSetId;
    const items = page?.items || [];
    for (const item of items) {
      if (item?.locationId) {
        observedIds.add(item.locationId);
      }
    }

    console.log(`Fetched observations page ${pageCount}`, {
      annotationSetId,
      itemCount: items.length,
      totalSoFar: observedIds.size,
    });

    nextToken = page?.nextToken ?? undefined;
  } while (nextToken);

  return observedIds;
}

async function requeueLocations(
  queue: QueueRecord,
  locationIds: string[],
  allowOutside = true
): Promise<void> {
  const queueType = await getQueueType(queue.url);
  const groupId = randomUUID();
  const batchSize = 10;
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];

  console.log('Sending messages to SQS', {
    queueUrl: queue.url,
    queueType,
    totalLocationIds: locationIds.length,
    batchSize,
  });

  for (let i = 0; i < locationIds.length; i += batchSize) {
    const locationBatch = locationIds.slice(i, i + batchSize);
    const entries = locationBatch.map((locationId) => {
      const messageBody = JSON.stringify({
        location: {
          id: locationId,
          annotationSetId: queue.annotationSetId,
        },
        queueId: queue.id,
        allowOutside,
        taskTag: queue.tag ?? queue.name,
        skipLocationWithAnnotations: false,
        isRequeued: true,
      });

      if (queueType === 'FIFO') {
        return {
          Id: `msg-${locationId}`,
          MessageBody: messageBody,
          MessageGroupId: groupId,
          MessageDeduplicationId: `requeue-${queue.requeuesCompleted ?? 0}-${locationId}`.substring(0, 128),
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
            QueueUrl: queue.url,
            Entries: entries,
          })
        );
      })
    );
  }

  await Promise.all(tasks);
  console.log('Finished sending all SQS batches');
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

async function logRequeueAction(queue: QueueRecord, count: number): Promise<void> {
  // Fetch project name and organizationId
  let projectName = 'Unknown';
  let organizationId: string | undefined;
  try {
    const response = (await client.graphql({
      query: getProject,
      variables: { id: queue.projectId },
    } as any)) as GraphQLResult<{
      getProject?: { id: string; name: string; organizationId?: string };
    }>;
    projectName = response.data?.getProject?.name ?? 'Unknown';
    organizationId = response.data?.getProject?.organizationId ?? undefined;
  } catch (err) {
    console.warn('Failed to fetch project name', err);
  }

  const queueName = queue.tag || queue.name || 'Unknown';
  const attemptNumber = (queue.requeuesCompleted ?? 0) + 1;
  const itemType =
    queue.tag === 'qc-review'
      ? 'unreviewed annotations'
      : queue.tag === 'info-tags'
        ? 'untagged annotations'
        : 'missing locations';
  const message = `Requeued ${count} ${itemType} for queue "${queueName}" (attempt ${attemptNumber}/${MAX_REQUEUES}) in project "${projectName}"`;

  try {
    await executeGraphql(createAdminActionLog, {
      input: {
        userId: 'SurveyScope',
        message,
        projectId: queue.projectId,
        group: organizationId,
      },
    });
  } catch (logError) {
    console.warn('Failed to create admin action log', logError);
  }
}

// ── QC Review requeue logic ──

async function processQCRequeue(queue: QueueRecord): Promise<number> {
  console.log('Processing QC review queue', { queueId: queue.id });

  // Download QC manifest (items are { annotationId, imageId }).
  const manifest = await downloadQCManifest(queue.locationManifestS3Key!);
  console.log('Downloaded QC manifest', { itemCount: manifest.length });

  // Group manifest items by imageId for efficient batch fetching.
  const manifestByImage = new Map<string, string[]>();
  for (const item of manifest) {
    const arr = manifestByImage.get(item.imageId);
    if (arr) arr.push(item.annotationId);
    else manifestByImage.set(item.imageId, [item.annotationId]);
  }

  // Fetch annotations by image, check which are still unreviewed.
  const unreviewedAnnotations = await fetchUnreviewedQCAnnotations(
    manifestByImage,
    queue.annotationSetId!
  );

  console.log('QC requeue check', {
    queueId: queue.id,
    launched: manifest.length,
    unreviewed: unreviewedAnnotations.length,
  });

  if (unreviewedAnnotations.length === 0) {
    console.log('No unreviewed QC annotations, updating requeuesCompleted', { queueId: queue.id });
    await executeGraphql(updateQueue, {
      input: {
        id: queue.id,
        emptyQueueTimestamp: null,
        requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      },
    });
    return 0;
  }

  // Requeue unreviewed annotations.
  console.log('Requeuing unreviewed QC annotations', {
    queueId: queue.id,
    count: unreviewedAnnotations.length,
  });

  await requeueQCAnnotations(queue, unreviewedAnnotations);

  // Update queue record.
  await executeGraphql(updateQueue, {
    input: {
      id: queue.id,
      emptyQueueTimestamp: null,
      requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      approximateSize: unreviewedAnnotations.length,
    },
  });

  // Log to AdminActionLog.
  await logRequeueAction(queue, unreviewedAnnotations.length);

  console.log('QC requeue complete', {
    queueId: queue.id,
    requeuedCount: unreviewedAnnotations.length,
    attemptNumber: (queue.requeuesCompleted ?? 0) + 1,
  });

  return unreviewedAnnotations.length;
}

async function downloadQCManifest(key: string): Promise<QCManifestItem[]> {
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
    throw new Error('Empty QC manifest file');
  }

  const manifest = JSON.parse(bodyStr);
  return manifest.items as QCManifestItem[];
}

async function fetchUnreviewedQCAnnotations(
  manifestByImage: Map<string, string[]>,
  annotationSetId: string
): Promise<QCAnnotationForRequeue[]> {
  const limit = pLimit(50);
  const unreviewed: QCAnnotationForRequeue[] = [];

  console.log('Fetching QC annotations for images', {
    imageCount: manifestByImage.size,
    annotationSetId,
  });

  await Promise.all(
    Array.from(manifestByImage.entries()).map(([imageId, annotationIds]) =>
      limit(async () => {
        const manifestSet = new Set(annotationIds);
        let nextToken: string | undefined = undefined;

        do {
          const response = (await client.graphql({
            query: annotationsByImageIdAndSetId,
            variables: {
              imageId,
              setId: { eq: annotationSetId },
              limit: 10000,
              nextToken,
            },
          } as any)) as GraphQLResult<{
            annotationsByImageIdAndSetId?: {
              items?: Array<{
                id: string;
                imageId: string;
                categoryId: string;
                setId: string;
                x: number;
                y: number;
                reviewCatId?: string | null;
              } | null>;
              nextToken?: string | null;
            };
          }>;

          if (response.errors && response.errors.length > 0) {
            throw new Error(
              `GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`
            );
          }

          const page = response.data?.annotationsByImageIdAndSetId;
          for (const item of page?.items || []) {
            // Include only annotations that are in the manifest AND still unreviewed.
            if (item && manifestSet.has(item.id) && !item.reviewCatId) {
              unreviewed.push({
                id: item.id,
                imageId: item.imageId,
                categoryId: item.categoryId,
                setId: item.setId,
                x: item.x,
                y: item.y,
              });
            }
          }
          nextToken = page?.nextToken ?? undefined;
        } while (nextToken);
      })
    )
  );

  return unreviewed;
}

async function requeueQCAnnotations(
  queue: QueueRecord,
  annotations: QCAnnotationForRequeue[]
): Promise<void> {
  const queueType = await getQueueType(queue.url);
  const groupId = randomUUID();
  const batchSize = 10;
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];

  console.log('Sending QC requeue messages to SQS', {
    queueUrl: queue.url,
    queueType,
    totalAnnotations: annotations.length,
  });

  for (let i = 0; i < annotations.length; i += batchSize) {
    const batch = annotations.slice(i, i + batchSize);
    const entries = batch.map((annotation) => {
      const messageBody = JSON.stringify({
        annotation: {
          id: annotation.id,
          annotationSetId: annotation.setId,
          imageId: annotation.imageId,
          categoryId: annotation.categoryId,
          x: annotation.x,
          y: annotation.y,
        },
        queueId: queue.id,
      });

      if (queueType === 'FIFO') {
        return {
          Id: `msg-${annotation.id}`,
          MessageBody: messageBody,
          MessageGroupId: groupId,
          MessageDeduplicationId: `requeue-${queue.requeuesCompleted ?? 0}-${annotation.id}`.substring(0, 128),
        };
      }

      return {
        Id: `msg-${annotation.id}`,
        MessageBody: messageBody,
      };
    });

    tasks.push(
      limit(async () => {
        await sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: queue.url,
            Entries: entries,
          })
        );
      })
    );
  }

  await Promise.all(tasks);
  console.log('Finished requeuing QC annotations');
}

// ── Homography requeue logic ──

const getImageNeighbourQuery = /* GraphQL */ `
  query GetImageNeighbour($image1Id: ID!, $image2Id: ID!) {
    getImageNeighbour(image1Id: $image1Id, image2Id: $image2Id) {
      image1Id image2Id homography skipped
    }
  }
`;

async function processInfoTagRequeue(queue: QueueRecord): Promise<number> {
  console.log('Processing informational tagging queue', { queueId: queue.id });
  const manifest = await downloadInfoTagManifest(queue.locationManifestS3Key!);
  const outstanding: InfoTagManifestItem[] = [];
  const limit = pLimit(50);

  await Promise.all(
    manifest.items.map((item) =>
      limit(async () => {
        const manifestIds = new Set(item.annotationIds);
        let nextToken: string | undefined;
        let hasOutstanding = false;
        do {
          const response = (await client.graphql({
            query: annotationsByImageIdAndSetId,
            variables: {
              imageId: item.imageId,
              setId: { eq: queue.annotationSetId! },
              limit: 10000,
              nextToken,
            },
          } as any)) as GraphQLResult<{
            annotationsByImageIdAndSetId?: {
              items?: Array<{
                id: string;
                infoTaggedBy?: string | null;
              } | null>;
              nextToken?: string | null;
            };
          }>;
          if (response.errors?.length) {
            throw new Error(
              `GraphQL error: ${JSON.stringify(
                response.errors.map((error) => error.message)
              )}`
            );
          }
          const page = response.data?.annotationsByImageIdAndSetId;
          hasOutstanding ||= (page?.items ?? []).some(
            (annotation) =>
              annotation != null &&
              manifestIds.has(annotation.id) &&
              !annotation.infoTaggedBy
          );
          nextToken = page?.nextToken ?? undefined;
        } while (nextToken && !hasOutstanding);

        if (hasOutstanding) outstanding.push(item);
      })
    )
  );

  if (outstanding.length === 0) {
    await executeGraphql(updateQueue, {
      input: {
        id: queue.id,
        emptyQueueTimestamp: null,
        requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      },
    });
    return 0;
  }

  await requeueInfoTagImages(queue, outstanding, manifest.categoryIds);
  await executeGraphql(updateQueue, {
    input: {
      id: queue.id,
      emptyQueueTimestamp: null,
      requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      approximateSize: outstanding.length,
    },
  });
  await logRequeueAction(queue, outstanding.length);
  return outstanding.length;
}

async function downloadInfoTagManifest(
  key: string
): Promise<InfoTagManifest> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  }
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  const body = await response.Body?.transformToString();
  if (!body) throw new Error('Empty informational tagging manifest file');
  return JSON.parse(body) as InfoTagManifest;
}

async function requeueInfoTagImages(
  queue: QueueRecord,
  items: InfoTagManifestItem[],
  categoryIds: string[]
) {
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];
  for (let offset = 0; offset < items.length; offset += 10) {
    const batch = items.slice(offset, offset + 10);
    tasks.push(
      limit(async () => {
        await sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: queue.url,
            Entries: batch.map((item, index) => ({
              Id: `msg-${offset + index}`,
              MessageBody: JSON.stringify({
                imageId: item.imageId,
                annotationSetId: queue.annotationSetId,
                categoryIds,
                queueId: queue.id,
                isRequeued: true,
              }),
            })),
          })
        );
      })
    );
  }
  await Promise.all(tasks);
}

type HomographyManifestItem = {
  pairKey: string;
  image1Id: string;
  image2Id: string;
  annotationSetId: string;
  primaryImage: Record<string, unknown>;
  secondaryImage: Record<string, unknown>;
};

async function processHomographyRequeue(queue: QueueRecord): Promise<number> {
  console.log('Processing homography queue', { queueId: queue.id });

  const manifest = await downloadHomographyManifest(queue.locationManifestS3Key!);
  console.log('Downloaded homography manifest', { itemCount: manifest.length });

  // Check each pair for completion
  const limit = pLimit(20);
  const unfinished: HomographyManifestItem[] = [];

  await Promise.all(
    manifest.map((item) =>
      limit(async () => {
        // pairKey is sorted, so id1 < id2 lexicographically
        const [id1, id2] = item.pairKey.split('::');

        // Try canonical ordering
        let nb = await getImageNeighbour(id1, id2);
        if (!nb) {
          nb = await getImageNeighbour(id2, id1);
        }

        const homographyComplete = nb?.homography && nb.homography.length === 9;
        const skipped = nb?.skipped === true;

        if (!homographyComplete && !skipped) {
          unfinished.push(item);
        }
      })
    )
  );

  console.log('Homography requeue check', {
    queueId: queue.id,
    launched: manifest.length,
    unfinished: unfinished.length,
  });

  if (unfinished.length === 0) {
    await executeGraphql(updateQueue, {
      input: {
        id: queue.id,
        emptyQueueTimestamp: null,
        requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      },
    });
    return 0;
  }

  // Requeue unfinished pairs
  await requeueHomographyPairs(queue, unfinished);

  await executeGraphql(updateQueue, {
    input: {
      id: queue.id,
      emptyQueueTimestamp: null,
      requeuesCompleted: (queue.requeuesCompleted ?? 0) + 1,
      approximateSize: unfinished.length,
    },
  });

  await logRequeueAction(queue, unfinished.length);

  console.log('Homography requeue complete', {
    queueId: queue.id,
    requeuedCount: unfinished.length,
  });

  return unfinished.length;
}

async function downloadHomographyManifest(key: string): Promise<HomographyManifestItem[]> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) throw new Error('OUTPUTS_BUCKET_NAME not set');

  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  const bodyStr = await response.Body?.transformToString();
  if (!bodyStr) throw new Error('Empty homography manifest file');

  const manifest = JSON.parse(bodyStr);
  return manifest.items as HomographyManifestItem[];
}

async function getImageNeighbour(
  image1Id: string,
  image2Id: string
): Promise<{ homography: number[] | null; skipped: boolean | null } | null> {
  try {
    const result = await executeGraphql<{
      getImageNeighbour?: {
        image1Id: string;
        image2Id: string;
        homography: number[] | null;
        skipped: boolean | null;
      } | null;
    }>(getImageNeighbourQuery, { image1Id, image2Id });
    return result.getImageNeighbour ?? null;
  } catch {
    return null;
  }
}

async function requeueHomographyPairs(
  queue: QueueRecord,
  pairs: HomographyManifestItem[]
): Promise<void> {
  const batchSize = 10;
  const limit = pLimit(10);
  const tasks: Array<Promise<void>> = [];

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const entries = batch.map((pair, j) => ({
      Id: `msg-${i + j}`,
      MessageBody: JSON.stringify({
        pairKey: pair.pairKey,
        queueId: queue.id,
        annotationSetId: pair.annotationSetId,
        primaryImage: pair.primaryImage,
        secondaryImage: pair.secondaryImage,
      }),
    }));

    tasks.push(
      limit(async () => {
        await sqsClient.send(
          new SendMessageBatchCommand({ QueueUrl: queue.url, Entries: entries })
        );
      })
    );
  }

  await Promise.all(tasks);
  console.log('Finished requeuing homography pairs', { count: pairs.length });
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
