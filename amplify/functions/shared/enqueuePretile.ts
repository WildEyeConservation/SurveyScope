import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import { loadImageTileStates, type ImageTileState } from './loadImageTileStates';

const MANIFEST_PREFIX = 'pretile-launch-manifests';

// Images tiled more recently than this are skipped entirely — tiles are fresh
// enough that neither re-tiling nor refreshing is needed. The watchdog will
// catch them before they expire if the project is still active.
const SKIP_MAX_AGE_DAYS = 30;

// Images tiled between SKIP and REFRESH age need their S3 tiles touched
// (CopyObject in place) to reset the lifecycle clock.
const REFRESH_MAX_AGE_DAYS = 55;

export type PretileWorkflow =
  | 'species-labelling'
  | 'false-negatives'
  | 'qc-review'
  | 'info-tags'
  | 'homography'
  | 'individual-id';

export type PretileManifest = {
  launchId: string;
  projectId: string;
  annotationSetId: string | null;
  workflow: PretileWorkflow;
  imageIds: string[];
  createdAt: string;
};

export type EnqueuePretileInput = {
  projectId: string;
  annotationSetId: string | null;
  workflow: PretileWorkflow;
  imageIds: string[];
  executeGraphql: <T>(query: string, variables: Record<string, any>) => Promise<T>;
  outputsBucket: string;
  queueUrl: string;
  refreshQueueUrl: string;
  sqsClient: SQSClient;
  s3Client: S3Client;
  // When true, the manifest is still written to S3 (and returned) but the
  // Project.pretileManifestS3Key pointer is NOT stamped. Used by the Individual
  // ID workflow, whose own reconciler owns the project status flip so it can
  // additionally wait for the transect-update fanout — preventing the generic
  // reconcilePretileLaunches cron from flipping the project to `active` early.
  skipProjectStamp?: boolean;
};

export type EnqueuePretileResult = {
  launchId: string;
  manifestKey: string | null;
  totalImages: number;
  enqueuedCount: number;
  refreshedCount: number;
  skippedFreshCount: number;
  skippedNoSourceCount: number;
  noWorkNeeded: boolean;
};

const getProjectQuery = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) {
      id
      organizationId
      tags
    }
  }
`;

const updateProjectMutation = /* GraphQL */ `
  mutation UpdateProject($input: UpdateProjectInput!) {
    updateProject(input: $input) {
      id
      group
    }
  }
`;

type ProjectRow = {
  id: string;
  organizationId: string;
  tags: string[] | null;
};

type ImageRow = ImageTileState;

/**
 * Write a pretile manifest, stamp the Project with the manifest key, and enqueue
 * pretile SQS messages for each image that doesn't already have `tiledAt` set.
 *
 * Ordering guarantee: the manifest file and the Project pointer are written
 * BEFORE any SQS message is sent. This ensures the reconciler always sees the
 * pointer before workers start flipping `Image.tiledAt`, so it cannot miss a
 * launch that completes between reconciler ticks.
 */
export async function enqueuePretile(
  input: EnqueuePretileInput
): Promise<EnqueuePretileResult> {
  const {
    projectId,
    annotationSetId,
    workflow,
    imageIds,
    executeGraphql,
    outputsBucket,
    queueUrl,
    refreshQueueUrl,
    sqsClient,
    s3Client,
    skipProjectStamp,
  } = input;

  const dedupedIds = Array.from(new Set(imageIds));
  const launchId = randomUUID();
  const manifestKey = `${MANIFEST_PREFIX}/${launchId}.json`;

  const projectData = await executeGraphql<{ getProject?: ProjectRow | null }>(
    getProjectQuery,
    { id: projectId }
  );
  const project = projectData.getProject;
  if (!project) throw new Error(`enqueuePretile: project ${projectId} not found`);
  const isLegacy = project.tags?.includes('legacy') ?? false;
  const imageKeyPrefix = isLegacy ? 'images/' : `images/${project.organizationId}/${projectId}/`;

  const tileStates = await loadImageTileStates(projectId, dedupedIds, executeGraphql);
  const imageRows = dedupedIds.map((id) => {
    const row = tileStates.get(id);
    if (!row) {
      console.warn(
        JSON.stringify({ msg: 'enqueue_pretile_missing_image', imageId: id })
      );
      return null;
    }
    return row;
  });

  // Partition images into four buckets:
  //   - skippedFresh:    tiledAt < 30 days old → tiles are fresh, no work needed
  //   - needsRefresh:    tiledAt 30–55 days old → CopyObject-in-place to reset lifecycle
  //   - needsTiling:     tiledAt > 55 days or missing → full re-tile from source
  //   - skippedNoSource: no originalPath → can't do anything
  const nowMs = Date.now();
  const skipCutoff = nowMs - SKIP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const refreshCutoff = nowMs - REFRESH_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const validRows = imageRows.filter((r): r is ImageRow => r !== null);
  const needsTiling: ImageRow[] = [];
  const needsRefresh: ImageRow[] = [];
  const skippedFresh: ImageRow[] = [];
  const skippedNoSource: ImageRow[] = [];
  for (const row of validRows) {
    if (!row.originalPath) {
      skippedNoSource.push(row);
      continue;
    }
    const tiledAtMs = row.tiledAt ? Date.parse(row.tiledAt) : NaN;
    if (Number.isFinite(tiledAtMs) && tiledAtMs >= skipCutoff) {
      skippedFresh.push(row);
    } else if (Number.isFinite(tiledAtMs) && tiledAtMs >= refreshCutoff) {
      needsRefresh.push(row);
    } else {
      needsTiling.push(row);
    }
  }

  if (skippedNoSource.length > 0) {
    console.warn(
      JSON.stringify({
        msg: 'enqueue_pretile_skipped_no_source',
        count: skippedNoSource.length,
        sample: skippedNoSource.slice(0, 5).map((r) => r.id),
      })
    );
  }

  if (skippedFresh.length > 0) {
    console.log(
      JSON.stringify({
        msg: 'enqueue_pretile_skipped_fresh',
        count: skippedFresh.length,
        sample: skippedFresh.slice(0, 5).map((r) => r.id),
      })
    );
  }

  // Manifest only includes images that will actually be worked on. Skipped-fresh
  // images are excluded so the reconciler doesn't wait for a tiledAt that will
  // never advance past manifestCreatedAt.
  const manifestImageIds = [
    ...needsTiling.map((r) => r.id),
    ...needsRefresh.map((r) => r.id),
  ];

  // Short-circuit if every image is already fresh
  if (manifestImageIds.length === 0) {
    const result: EnqueuePretileResult = {
      launchId,
      manifestKey: null,
      totalImages: dedupedIds.length,
      enqueuedCount: 0,
      refreshedCount: 0,
      skippedFreshCount: skippedFresh.length,
      skippedNoSourceCount: skippedNoSource.length,
      noWorkNeeded: true,
    };
    console.log(JSON.stringify({ msg: 'enqueue_pretile_no_work', ...result }));
    return result;
  }

  const manifestCreatedAt = new Date().toISOString();
  const manifest: PretileManifest = {
    launchId,
    projectId,
    annotationSetId,
    workflow,
    imageIds: manifestImageIds,
    createdAt: manifestCreatedAt,
  };

  await s3Client.send(
    new PutObjectCommand({
      Bucket: outputsBucket,
      Key: manifestKey,
      Body: JSON.stringify(manifest),
      ContentType: 'application/json',
    })
  );

  if (!skipProjectStamp) {
    await executeGraphql(updateProjectMutation, {
      input: { id: projectId, pretileManifestS3Key: manifestKey },
    });
  }

  // Fan out SQS sends for both queues in parallel. Each row produces a message
  // with the same shape regardless of which queue it goes to — the refresh
  // worker derives the slippymaps prefix from sourceKey just like pretile.
  async function fanOut(
    rows: ImageRow[],
    targetQueueUrl: string,
    idPrefix: string
  ): Promise<void> {
    if (rows.length === 0) return;
    const sqsBatchSize = 10;
    const sendLimit = pLimit(10);
    const sendTasks: Array<Promise<void>> = [];
    for (let i = 0; i < rows.length; i += sqsBatchSize) {
      const batch = rows.slice(i, i + sqsBatchSize);
      const entries = batch.map((row, j) => ({
        Id: `${idPrefix}-${i + j}`,
        MessageBody: JSON.stringify({
          imageId: row.id,
          projectId,
          sourceKey: `${imageKeyPrefix}${row.originalPath}`,
          launchId,
          manifestCreatedAt,
        }),
      }));
      sendTasks.push(
        sendLimit(async () => {
          const resp = await sqsClient.send(
            new SendMessageBatchCommand({
              QueueUrl: targetQueueUrl,
              Entries: entries,
            })
          );
          if (resp.Failed && resp.Failed.length > 0) {
            throw new Error(
              `SQS batch failed for ${idPrefix} enqueue: ${JSON.stringify(resp.Failed)}`
            );
          }
        })
      );
    }
    await Promise.all(sendTasks);
  }

  await Promise.all([
    fanOut(needsTiling, queueUrl, 'pre'),
    fanOut(needsRefresh, refreshQueueUrl, 'ref'),
  ]);

  const result: EnqueuePretileResult = {
    launchId,
    manifestKey,
    totalImages: dedupedIds.length,
    enqueuedCount: needsTiling.length,
    refreshedCount: needsRefresh.length,
    skippedFreshCount: skippedFresh.length,
    skippedNoSourceCount: skippedNoSource.length,
    noWorkNeeded: false,
  };

  console.log(JSON.stringify({ msg: 'enqueue_pretile_complete', ...result }));
  return result;
}
