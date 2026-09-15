import type { RunImageRegistrationHandler } from '../../data/resource';
import { env } from '$amplify/env/runImageRegistration';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { authorizeRequest } from '../shared/authorizeRequest';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  cameraOverlapsByProjectId,
  getImageNeighbour,
  imagesByProjectId,
  getProject,
} from './graphql/queries';
import {
  CameraOverlap,
  GetImageNeighbourQuery,
  GetProjectQuery,
} from '../runImageRegistration/graphql/API';

// Return key fields + `group` to avoid nested-resolver auth failures while
// keeping subscription delivery via groupDefinedIn('group') working.
const createImageNeighbour = /* GraphQL */ `
  mutation CreateImageNeighbour($input: CreateImageNeighbourInput!) {
    createImageNeighbour(input: $input) { image1Id image2Id group cameraPairKey bucketIndex }
  }
`;

// Per-image marker the upload Finalizer uses to find undispatched images.
export const REGISTRATION_DISPATCH_SOURCE = 'registration-dispatch';

const createImageProcessedBy = /* GraphQL */ `
  mutation CreateImageProcessedBy($input: CreateImageProcessedByInput!) {
    createImageProcessedBy(input: $input) { imageId source }
  }
`;

const deleteImageNeighbour = /* GraphQL */ `
  mutation DeleteImageNeighbour($input: DeleteImageNeighbourInput!) {
    deleteImageNeighbour(input: $input) { image1Id image2Id }
  }
`;

const incrementRegistrationProgress = /* GraphQL */ `
  mutation IncrementRegistrationProgress(
    $projectId: ID!
    $pairsCreatedDelta: Int
    $kickoff: Boolean
    $group: String
  ) {
    incrementRegistrationProgress(
      projectId: $projectId
      pairsCreatedDelta: $pairsCreatedDelta
      kickoff: $kickoff
      group: $group
    )
  }
`;

const registrationBucketStatsByProjectId = /* GraphQL */ `
  query StatsByProject($projectId: ID!, $limit: Int, $nextToken: String) {
    registrationBucketStatsByProjectId(
      projectId: $projectId
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        projectId
        cameraPairKey
        bucketIndex
        successCount
      }
      nextToken
    }
  }
`;

interface BucketStatRow {
  projectId: string;
  cameraPairKey: string;
  bucketIndex: number;
  successCount?: number | null;
}

// Mirrors registrationBucketCleanup's tie-break (duplicated, no shared module).
function compareBuckets(a: number, b: number): number {
  if (a === 0 && b !== 0) return -1;
  if (b === 0 && a !== 0) return 1;
  const absDiff = Math.abs(a) - Math.abs(b);
  if (absDiff !== 0) return absDiff;
  return a - b;
}

function pickWinningBucket(stats: BucketStatRow[]): number {
  let bestIndex = stats[0].bucketIndex;
  let bestCount = stats[0].successCount ?? 0;
  for (let i = 1; i < stats.length; i++) {
    const c = stats[i].successCount ?? 0;
    if (
      c > bestCount ||
      (c === bestCount && compareBuckets(stats[i].bucketIndex, bestIndex) < 0)
    ) {
      bestIndex = stats[i].bucketIndex;
      bestCount = c;
    }
  }
  return bestIndex;
}

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

interface PagedList<T> {
  items: T[];
  nextToken: string | null | undefined;
}

type SqsEntry = SendMessageBatchRequestEntry;

interface MinimalImage {
  id: string;
  originalPath?: string | null;
  timestamp?: number | null;
  cameraId?: string | null;
}

async function gqlWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delayMs = 300 * 2 ** attemptIndex + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError as Error;
}

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    for (
      let currentIndex = nextIndex++;
      currentIndex < tasks.length;
      currentIndex = nextIndex++
    ) {
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workerCount = Math.min(limit, tasks.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function fetchAllPages<T, K extends string>(
  queryFn: (
    nextToken?: string
  ) => Promise<GraphQLResult<{ [key in K]: PagedList<T> }>>,
  queryName: K
): Promise<T[]> {
  const allItems: T[] = [];
  let nextToken: string | undefined;

  do {
    console.log(`Fetching ${queryName} next page`);
    const response = await queryFn(nextToken);
    const items = response.data?.[queryName]?.items ?? [];
    allItems.push(...(items as T[]));
    nextToken = response.data?.[queryName]?.nextToken ?? undefined;
  } while (nextToken);

  console.log(
    `Completed fetching all ${queryName} pages. Total items: ${allItems.length}`
  );
  return allItems;
}

async function handlePair(
  image1: MinimalImage,
  image2: MinimalImage,
  masks: number[][][],
  computeKey: (orig: string) => string,
  projectId: string,
  organizationId?: string,
  // Same-camera pairs leave these null to stay out of the bucket-cleanup GSI.
  cameraPairKey?: string,
  bucketIndex?: number,
  // Re-runs skip pairs LightGlue already tried and failed (suggestedPoints1 set).
  skipExistingSuggestions?: boolean,
  // Re-runs against an established winner skip the RegistrationBucketStat
  // increment to keep the lock-in stable.
  skipBucketStat?: boolean
) {
  try {
    console.log(`Processing pair ${image1.id} and ${image2.id}`);

    if (!image1 || !image2) {
      console.log(
        `Skipping pair ${image1.id} and ${image2.id} because one of the images is null`
      );
      return null;
    }

    const neighbourResp = (await gqlWithRetry(() =>
      client.graphql({
        query: getImageNeighbour,
        variables: {
          image1Id: image1.id,
          image2Id: image2.id,
        },
      })
    )) as GraphQLResult<GetImageNeighbourQuery>;
    const existingNeighbour = neighbourResp.data?.getImageNeighbour;

    if (existingNeighbour?.homography) {
      console.log(
        `Homography already exists for pair ${image1.id} and ${image2.id}`
      );
      return null; // Return null for filtered pairs
    }

    if (skipExistingSuggestions) {
      // Untyped cast — suggestedPoints1 may be missing from stale codegen.
      const suggested = (existingNeighbour as { suggestedPoints1?: number[] | null } | null | undefined)?.suggestedPoints1;
      if (Array.isArray(suggested) && suggested.length > 0) {
        console.log(
          `Suggestions already exist for pair ${image1.id} and ${image2.id}; skipping (skipExistingSuggestions)`
        );
        return null;
      }
    }

    if (!existingNeighbour) {
      // bucketIndex is the GSI sort key — DDB rejects explicit null. For
      // same-camera pairs we need the attribute ABSENT, not null, so the row
      // isn't projected into the GSI.
      const input: Record<string, unknown> = {
        image1Id: image1.id,
        image2Id: image2.id,
        projectId,
        group: organizationId,
      };
      if (cameraPairKey != null && bucketIndex != null) {
        input.cameraPairKey = cameraPairKey;
        input.bucketIndex = bucketIndex;
      }

      try {
        await gqlWithRetry(() =>
          client.graphql({
            query: createImageNeighbour,
            variables: { input },
          }) as Promise<GraphQLResult<any>>
        );
      } catch (e: unknown) {
        const errors = ((): unknown[] => {
          if (typeof e === 'object' && e !== null && 'errors' in e) {
            const maybe = (e as { errors?: unknown }).errors;
            if (Array.isArray(maybe)) return maybe;
          }
          return [];
        })();
        const isConditionalFailure = errors.some((x) => {
          if (typeof x === 'object' && x !== null && 'errorType' in x) {
            const errorType = (x as { errorType?: unknown }).errorType;
            return String(errorType ?? '').includes(
              'ConditionalCheckFailedException'
            );
          }
          return false;
        });
        if (isConditionalFailure) {
          console.log(
            `Neighbour already exists (created concurrently) for ${image1.id}/${image2.id}`
          );
        } else {
          throw e;
        }
      }
    }

    // Return the message instead of sending it immediately
    const originalPath1 = image1.originalPath ?? null;
    const originalPath2 = image2.originalPath ?? null;
    if (!originalPath1 || !originalPath2) {
      console.log(
        `Skipping pair ${image1.id} and ${image2.id} due to missing originalPath`
      );
      return null;
    }

    return {
      Id: `${image1.id}-${image2.id}`,
      MessageBody: JSON.stringify({
        image1Id: image1.id,
        image2Id: image2.id,
        keys: [computeKey(originalPath1), computeKey(originalPath2)],
        action: 'register',
        masks: masks.length > 0 ? masks : undefined,
        projectId,
        group: organizationId,
        cameraPairKey: cameraPairKey ?? null,
        bucketIndex: bucketIndex ?? null,
        skipBucketStat: skipBucketStat ? true : undefined,
      }),
    };
  } catch (error: unknown) {
    // A failed pair must keep its images unmarked so the Finalizer retries.
    pairBuildFailures += 1;
    console.error(
      `Error in handlePair for ${image1.id} and ${image2.id}:`,
      error
    );
    return null;
  }
}

function addAdjacentPairTasks(
  images: MinimalImage[],
  masks: number[][][],
  seenPairs: Set<string>,
  outTasks: Array<() => Promise<SqsEntry | null>>,
  computeKey: (orig: string) => string,
  projectId: string,
  organizationId?: string,
  skipExistingSuggestions?: boolean
) {
  for (let i = 0; i < images.length - 1; i++) {
    const image1 = images[i];
    const image2 = images[i + 1];
    const timeDeltaSeconds = (image2.timestamp ?? 0) - (image1.timestamp ?? 0);
    if (timeDeltaSeconds < 5) {
      const key = [image1.id, image2.id].sort().join('|');
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        outTasks.push(() =>
          handlePair(
            image1,
            image2,
            masks,
            computeKey,
            projectId,
            organizationId,
            undefined,
            undefined,
            skipExistingSuggestions
          )
        );
      }
    } else {
      console.log(
        `Skipping pair ${image1.id} and ${image2.id} because the time difference is greater than 5 seconds`,
        timeDeltaSeconds
      );
    }
  }
}

// Median (not mean) — robust to dropped frames that would skew the estimate.
function medianConsecutiveDelta(sortedImgs: MinimalImage[]): number | null {
  if (sortedImgs.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < sortedImgs.length; i++) {
    const t1 = sortedImgs[i - 1].timestamp;
    const t2 = sortedImgs[i].timestamp;
    if (t1 != null && t2 != null) {
      const d = t2 - t1;
      if (d > 0) deltas.push(d);
    }
  }
  if (deltas.length === 0) return null;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  return deltas.length % 2 === 0
    ? (deltas[mid - 1] + deltas[mid]) / 2
    : deltas[mid];
}

// Half of the OTHER camera's firing interval is the cutoff between
// "synchronous partner" and "next-frame partner".
const DEFAULT_THRESHOLD_SECONDS = 1.0;
// Floor at 2s — integer-second timestamps make <1s require exact-second match,
// which is stricter than the rig actually is. Bucket cleanup absorbs strays.
const MIN_THRESHOLD_SECONDS = 2.0;
const MAX_THRESHOLD_SECONDS = 5.0;

function deriveCrossCameraThresholds(
  imgsA: MinimalImage[],
  imgsB: MinimalImage[]
): { thresholdToB: number; thresholdToA: number } {
  const medianA = medianConsecutiveDelta(imgsA);
  const medianB = medianConsecutiveDelta(imgsB);
  const clamp = (v: number) =>
    Math.max(MIN_THRESHOLD_SECONDS, Math.min(v, MAX_THRESHOLD_SECONDS));
  return {
    thresholdToB: clamp(0.5 * (medianB ?? medianA ?? DEFAULT_THRESHOLD_SECONDS)),
    thresholdToA: clamp(0.5 * (medianA ?? medianB ?? DEFAULT_THRESHOLD_SECONDS)),
  };
}

// `candidates` must be sorted ascending by timestamp.
function findNearestIndex(
  target: MinimalImage,
  candidates: MinimalImage[],
  thresholdSeconds: number
): number {
  if (candidates.length === 0 || target.timestamp == null) return -1;
  const t = target.timestamp;
  let lo = 0;
  let hi = candidates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((candidates[mid].timestamp ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  let bestIdx = -1;
  let bestDelta = Infinity;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= candidates.length) continue;
    const c = candidates[i];
    if (c.timestamp == null || c.id === target.id) continue;
    const delta = Math.abs(c.timestamp - t);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx !== -1 && bestDelta <= thresholdSeconds ? bestIdx : -1;
}

// Sorting fixes which camera is "A side" (lower id), so bucketIndex labels
// are consistent regardless of how CameraOverlap was configured.
function canonicalCameraPairKey(camIdX: string, camIdY: string): string {
  return camIdX < camIdY ? `${camIdX}|${camIdY}` : `${camIdY}|${camIdX}`;
}

// Emits buckets 0/-1/+1 per A image (B's nearest, predecessor, successor).
// bucketIndex is always B's-track offset so the same physical rig-offset lands
// in the same bucket across all A's. forcedBucket locks in an established
// winner; skipBucketStat tells the container not to drift it on re-runs.
function addNearestBucketTasks(
  imgsACam: MinimalImage[],
  imgsBCam: MinimalImage[],
  thresholdToB: number,
  cameraPairKey: string,
  masks: number[][][],
  seenPairs: Set<string>,
  outTasks: Array<() => Promise<SqsEntry | null>>,
  computeKey: (orig: string) => string,
  projectId: string,
  organizationId?: string,
  skipExistingSuggestions?: boolean,
  forcedBucket?: number
) {
  const skipBucketStat = forcedBucket != null;
  const queue = (
    x: MinimalImage,
    y: MinimalImage,
    bucketIndex: number
  ) => {
    const [first, second] =
      (x.timestamp ?? 0) <= (y.timestamp ?? 0) ? [x, y] : [y, x];
    const key = [first.id, second.id].sort().join('|');
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    outTasks.push(() =>
      handlePair(
        first,
        second,
        masks,
        computeKey,
        projectId,
        organizationId,
        cameraPairKey,
        bucketIndex,
        skipExistingSuggestions,
        skipBucketStat
      )
    );
  };

  for (const a of imgsACam) {
    const nIdx = findNearestIndex(a, imgsBCam, thresholdToB);
    if (nIdx === -1) continue;
    if (forcedBucket != null) {
      const idx = nIdx + forcedBucket;
      if (idx >= 0 && idx < imgsBCam.length) queue(a, imgsBCam[idx], forcedBucket);
      continue;
    }
    if (nIdx - 1 >= 0) queue(a, imgsBCam[nIdx - 1], -1);
    queue(a, imgsBCam[nIdx], 0);
    if (nIdx + 1 < imgsBCam.length) queue(a, imgsBCam[nIdx + 1], 1);
  }
}

function addStalePairDeletionTasks(
  images: MinimalImage[],
  sessionIdSet: Set<string>,
  outTasks: Array<() => Promise<void>>
) {
  let leftBoundary: MinimalImage | null = null;
  let hasSessionSince = false;

  for (const img of images) {
    if (sessionIdSet.has(img.id)) {
      hasSessionSince = true;
    } else {
      if (leftBoundary && hasSessionSince) {
        const lb = leftBoundary;
        const rb = img;
        outTasks.push(async () => {
          const resp = (await gqlWithRetry(() =>
            client.graphql({
              query: getImageNeighbour,
              variables: { image1Id: lb.id, image2Id: rb.id },
            })
          )) as GraphQLResult<GetImageNeighbourQuery>;
          if (resp.data?.getImageNeighbour) {
            await gqlWithRetry(() =>
              client.graphql({
                query: deleteImageNeighbour,
                variables: { input: { image1Id: lb.id, image2Id: rb.id } },
              }) as Promise<GraphQLResult<any>>
            );
            console.log(`Deleted stale pair ${lb.id} / ${rb.id}`);
          }
        });
      }
      leftBoundary = img;
      hasSessionSince = false;
    }
  }
}

async function markImagesDispatched(
  images: MinimalImage[],
  projectId: string,
  organizationId?: string
): Promise<void> {
  const tasks = images.map((img) => async () => {
    try {
      await gqlWithRetry(() =>
        client.graphql({
          query: createImageProcessedBy,
          variables: {
            input: {
              imageId: img.id,
              source: REGISTRATION_DISPATCH_SOURCE,
              projectId,
              group: organizationId,
            },
          },
        }) as Promise<GraphQLResult<unknown>>
      );
    } catch (e: unknown) {
      if (!isConditionalCheckFailure(e)) {
        console.error(`Failed to mark image ${img.id} as dispatched:`, e);
      }
    }
  });
  await withConcurrency(tasks, 10);
}

function isConditionalCheckFailure(e: unknown): boolean {
  const errors =
    typeof e === 'object' && e !== null && Array.isArray((e as { errors?: unknown }).errors)
      ? ((e as { errors: unknown[] }).errors)
      : [];
  return errors.some((x) => {
    if (typeof x === 'object' && x !== null && 'errorType' in x) {
      return String((x as { errorType?: unknown }).errorType ?? '').includes(
        'ConditionalCheckFailedException'
      );
    }
    return false;
  });
}

// Reset per invocation; skipped pairs are not failures, only thrown ones.
let pairBuildFailures = 0;

export const handler: RunImageRegistrationHandler = async (event, context) => {
  pairBuildFailures = 0;
  try {
    context.callbackWaitsForEmptyEventLoop = false;
    const projectId = event.arguments.projectId;
    const metadata = JSON.parse(event.arguments.metadata) as {
      masks?: number[][][];
      images?: Array<{
        id: string;
        originalPath: string;
        timestamp?: number | null;
        cameraId?: string | null;
      }>;
      sessionIds?: string[];
      skipExistingSuggestions?: boolean;
    };
    const masks = Array.isArray(metadata?.masks) ? (metadata.masks as number[][][]) : [];
    const skipExistingSuggestions = !!metadata?.skipExistingSuggestions;
    const queueUrl = event.arguments.queueUrl;

    let organizationId: string | undefined = undefined;
    let isLegacyProject = false;
    try {
      const projResp = (await client.graphql({
        query: getProject,
        variables: { id: projectId },
      })) as GraphQLResult<GetProjectQuery>;
      organizationId = projResp.data?.getProject?.organizationId;
      const tagsRaw = projResp.data?.getProject?.tags ?? [];
      const tags = Array.isArray(tagsRaw)
        ? tagsRaw.filter((t): t is string => typeof t === 'string')
        : [];
      isLegacyProject = tags.includes('legacy');
    } catch (e) {
      console.warn(
        'Unable to fetch project tags; defaulting to legacy=false behavior'
      );
    }

    if (organizationId) {
      authorizeRequest(event.identity, organizationId);
    }

    const computeKey = (orig: string) =>
      !isLegacyProject && organizationId
        ? `${organizationId}/${projectId}/${orig}`
        : orig;

    // If metadata supplies a batch, use it to avoid scanning the whole project.
    const providedBatch = Array.isArray(metadata?.images)
      ? metadata.images.filter((it): it is NonNullable<typeof it> => Boolean(it))
      : [];

    const images: MinimalImage[] = providedBatch.length
      ? providedBatch.map((it) => ({
        id: it.id,
        originalPath: it.originalPath,
        timestamp:
          typeof it.timestamp === 'number' ? (it.timestamp as number) : null,
        cameraId: (it.cameraId ?? null) as string | null,
      }))
      : (await fetchAllPages<
        { id: string; originalPath?: string | null; timestamp?: number | null; cameraId?: string | null },
        'imagesByProjectId'
      >(
        (nextToken) =>
          client.graphql({
            query: imagesByProjectId,
            variables: { projectId, nextToken, limit: 10000 },
          }) as Promise<
            GraphQLResult<{
              imagesByProjectId: PagedList<{
                id: string;
                originalPath?: string | null;
                timestamp?: number | null;
                cameraId?: string | null;
              }>;
            }>
          >,
        'imagesByProjectId'
      )).map((img) => ({
        id: img.id,
        originalPath: img.originalPath ?? null,
        timestamp: typeof img.timestamp === 'number' ? img.timestamp : null,
        cameraId: (img.cameraId ?? null) as string | null,
      }));

    const sortedImages = images.sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
    );

    const cameraOverlaps = await fetchAllPages<
      CameraOverlap,
      'cameraOverlapsByProjectId'
    >(
      (nextToken) =>
        client.graphql({
          query: cameraOverlapsByProjectId,
          variables: { projectId, nextToken, limit: 10000 },
        }) as Promise<
          GraphQLResult<{ cameraOverlapsByProjectId: PagedList<CameraOverlap> }>
        >,
      'cameraOverlapsByProjectId'
    );

    const noCamImgs: MinimalImage[] = [];

    const imagesByCamera = sortedImages.reduce((acc, image) => {
      if (!image.cameraId) {
        noCamImgs.push(image);
        return acc;
      }

      const cameraId = image.cameraId;
      if (!acc[cameraId]) {
        acc[cameraId] = [];
      }
      acc[cameraId].push(image);

      return acc;
    }, {} as Record<string, MinimalImage[]>);

    const tasks: Array<() => Promise<SqsEntry | null>> = [];
    const seenPairs = new Set<string>();
    const deletionTasks: Array<() => Promise<void>> = [];
    const sessionIdSet = new Set<string>(
      Array.isArray(metadata?.sessionIds) ? metadata.sessionIds : []
    );

    Object.entries(imagesByCamera).forEach(([, images]) => {
      addAdjacentPairTasks(
        images,
        masks,
        seenPairs,
        tasks,
        computeKey,
        projectId,
        organizationId,
        skipExistingSuggestions
      );
      if (sessionIdSet.size > 0) {
        addStalePairDeletionTasks(images, sessionIdSet, deletionTasks);
      }
    });

    const existingStats = await fetchAllPages<BucketStatRow, 'registrationBucketStatsByProjectId'>(
      (nextToken) =>
        client.graphql({
          query: registrationBucketStatsByProjectId,
          variables: { projectId, limit: 1000, nextToken },
        }) as Promise<GraphQLResult<{ registrationBucketStatsByProjectId: PagedList<BucketStatRow> }>>,
      'registrationBucketStatsByProjectId'
    );

    const winnersByPair = new Map<string, number>();
    {
      const byPair = new Map<string, BucketStatRow[]>();
      for (const row of existingStats) {
        const list = byPair.get(row.cameraPairKey) ?? [];
        list.push(row);
        byPair.set(row.cameraPairKey, list);
      }
      for (const [pairKey, rows] of byPair) {
        if (rows.some((r) => (r.successCount ?? 0) > 0)) {
          winnersByPair.set(pairKey, pickWinningBucket(rows));
        }
      }
    }
    console.log(
      `Re-run detection: ${winnersByPair.size} camera pair(s) with established winners`
    );

    // 3-nearest bucket pairing for overlapping cameras; bucket cleanup picks
    // the winning offset and absorbs stale-pair deletion.
    cameraOverlaps.forEach((overlap) => {
      const camIdLow =
        overlap.cameraAId < overlap.cameraBId
          ? overlap.cameraAId
          : overlap.cameraBId;
      const camIdHigh =
        overlap.cameraAId < overlap.cameraBId
          ? overlap.cameraBId
          : overlap.cameraAId;
      const imgsACam = imagesByCamera[camIdLow] ?? [];
      const imgsBCam = imagesByCamera[camIdHigh] ?? [];
      if (imgsACam.length === 0 || imgsBCam.length === 0) return;

      const cameraPairKey = canonicalCameraPairKey(camIdLow, camIdHigh);
      // Only iterate A → look up B, so only thresholdToB is needed.
      const { thresholdToB } = deriveCrossCameraThresholds(imgsACam, imgsBCam);
      const forcedBucket = winnersByPair.get(cameraPairKey);
      console.log(
        `CameraOverlap ${cameraPairKey}: thresholdToB=${thresholdToB.toFixed(3)}s, |A|=${imgsACam.length}, |B|=${imgsBCam.length}` +
          (forcedBucket != null ? `, forcedBucket=${forcedBucket}` : '')
      );

      addNearestBucketTasks(
        imgsACam,
        imgsBCam,
        thresholdToB,
        cameraPairKey,
        masks,
        seenPairs,
        tasks,
        computeKey,
        projectId,
        organizationId,
        skipExistingSuggestions,
        forcedBucket
      );
    });

    addAdjacentPairTasks(
      noCamImgs,
      masks,
      seenPairs,
      tasks,
      computeKey,
      projectId,
      organizationId,
      skipExistingSuggestions
    );
    if (sessionIdSet.size > 0 && noCamImgs.length > 0) {
      addStalePairDeletionTasks(noCamImgs, sessionIdSet, deletionTasks);
    }

    if (deletionTasks.length > 0) {
      console.log(`Deleting ${deletionTasks.length} stale neighbour pair(s)`);
      await withConcurrency(deletionTasks, 10);
    }

    const messages = (await withConcurrency<SqsEntry | null>(tasks, 10)).filter(
      (msg): msg is NonNullable<typeof msg> => msg !== null
    );

    const sqsClient = new SQSClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      },
    });

    let sqsFailures = 0;
    for (let i = 0; i < messages.length; i += 10) {
      const batch = messages.slice(i, i + 10);
      try {
        const result = await sqsClient.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: batch,
          })
        );
        sqsFailures += result.Failed?.length ?? 0;
      } catch (error: unknown) {
        sqsFailures += batch.length;
        console.error(`Error sending SQS batch at index ${i}:`, error);
      }
    }

    if (sqsFailures === 0 && pairBuildFailures === 0) {
      await markImagesDispatched(sortedImages, projectId, organizationId);
    } else {
      console.error(
        `${sqsFailures} SQS message(s) and ${pairBuildFailures} pair(s) failed; leaving ${sortedImages.length} image(s) unmarked for redispatch`
      );
    }

    // Always kickoff so a previously-'done' cycle gets re-evaluated by the
    // monitor — even when no new SQS messages were sent.
    if (messages.length > 0 || sessionIdSet.size > 0) {
      try {
        await gqlWithRetry(() =>
          client.graphql({
            query: incrementRegistrationProgress,
            variables: {
              projectId,
              pairsCreatedDelta: messages.length,
              kickoff: true,
              group: organizationId ?? null,
            },
          }) as Promise<GraphQLResult<any>>
        );
        console.log(
          `RegistrationProgress: pairsCreated += ${messages.length}, kickoff stamped for project ${projectId}`
        );
      } catch (e) {
        console.error('Failed to increment RegistrationProgress:', e);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Images received',
        count: sortedImages.length,
      }),
    };
  } catch (error: unknown) {
    console.error('Error in runImageRegistration:', error);
    const errorDetails = (() => {
      if (error instanceof Error) {
        return { message: error.message, stack: error.stack, name: error.name };
      }
      return { message: String(error) };
    })();
    console.error('Error details:', errorDetails);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error running image registration',
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      }),
    };
  }
};
