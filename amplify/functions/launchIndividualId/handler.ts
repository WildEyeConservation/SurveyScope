import type { LaunchIndividualIdHandler } from '../../data/resource';
import { env } from '$amplify/env/launchIndividualId';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { authorizeRequest } from '../shared/authorizeRequest';
import { enqueuePretile } from '../shared/enqueuePretile';
import { detectTransects } from '../shared/detectTransects';
import {
  isOnEffort,
  type BoundaryStatus,
} from '../../../shared/boundaryStatus';
import { assignOutsideImages, includeOutsideTransect } from './outside';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import pLimit from 'p-limit';
import {
  createShadowWorkflowRun,
  workflowLaunchUserId,
} from '../workflowStats/runWriter';

const getProjectOrganizationId = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { organizationId }
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

const transectsByProjectIdQuery = /* GraphQL */ `
  query TransectsByProjectId($projectId: ID!, $limit: Int, $nextToken: String) {
    transectsByProjectId(projectId: $projectId, limit: $limit, nextToken: $nextToken) {
      items { id stratumId }
      nextToken
    }
  }
`;

const strataByProjectIdQuery = /* GraphQL */ `
  query StrataByProjectId($projectId: ID!, $limit: Int, $nextToken: String) {
    strataByProjectId(projectId: $projectId, limit: $limit, nextToken: $nextToken) {
      items { id offEffort }
      nextToken
    }
  }
`;

const imagesByProjectIdQuery = /* GraphQL */ `
  query ImagesByProjectId($projectId: ID!, $limit: Int, $nextToken: String) {
    imagesByProjectId(projectId: $projectId, limit: $limit, nextToken: $nextToken) {
      items { id timestamp latitude longitude cameraId transectId boundaryStatus }
      nextToken
    }
  }
`;

const createStratumMutation = /* GraphQL */ `
  mutation CreateStratum($input: CreateStratumInput!) {
    createStratum(input: $input) { id group }
  }
`;

const createTransectMutation = /* GraphQL */ `
  mutation CreateTransect($input: CreateTransectInput!) {
    createTransect(input: $input) { id group }
  }
`;

const createIndividualIdJobMutation = /* GraphQL */ `
  mutation CreateIndividualIdJob($input: CreateIndividualIdJobInput!) {
    createIndividualIdJob(input: $input) { id group }
  }
`;

const updateIndividualIdJobMutation = /* GraphQL */ `
  mutation UpdateIndividualIdJob($input: UpdateIndividualIdJobInput!) {
    updateIndividualIdJob(input: $input) { id group }
  }
`;

const createIndividualIdTransectMutation = /* GraphQL */ `
  mutation CreateIndividualIdTransect($input: CreateIndividualIdTransectInput!) {
    createIndividualIdTransect(input: $input) { id group }
  }
`;

const neighboursByImage1Query = /* GraphQL */ `
  query NeighboursByImage1($image1Id: ID!, $nextToken: String) {
    imageNeighboursByImage1key(image1Id: $image1Id, limit: 1000, nextToken: $nextToken) {
      items { image2Id skipped homography }
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

type LaunchIndividualIdPayload = {
  projectId: string;
  annotationSetId: string;
  categoryId: string;
  categoryName?: string;
  // Distinct image IDs that have at least one annotation of the chosen
  // category. Computed client-side from the full annotation scan.
  annotatedImageIds: string[];
  // Transects the client (running the same Munkres/completion logic as the
  // harness) found to still have linking work. When present we only create
  // availability rows for these — already-finished transects are skipped so
  // users are never handed a transect with nothing to do. Omitted when the
  // project has no transects yet (the lambda detects/creates them and a
  // fresh project has no completed work to skip).
  incompleteTransectIds?: string[];
  // Whether the client found linking work among images outside the survey
  // area. Older clients omit it.
  includeOutside?: boolean;
  payloadS3Key?: string;
};

type ProjectImageRow = {
  id: string;
  timestamp: number | null;
  latitude: number | null;
  longitude: number | null;
  cameraId: string | null;
  transectId: string | null;
  boundaryStatus: BoundaryStatus | null;
};

type NeighboursByImage1Result = {
  imageNeighboursByImage1key?: {
    items: Array<{
      image2Id: string;
      skipped: boolean | null;
      homography: number[] | null;
    }>;
    nextToken?: string | null;
  };
};

export const handler: LaunchIndividualIdHandler = async (event) => {
  let payloadS3Key: string | undefined;
  try {
    let payload = parsePayload(event.arguments?.request);

    if (payload.payloadS3Key) {
      payloadS3Key = payload.payloadS3Key;
      console.log('Reading payload from S3', { key: payloadS3Key });
      payload = await readPayloadFromS3(payloadS3Key);
    }

    console.log(
      'launchIndividualId invoked',
      JSON.stringify({
        projectId: payload.projectId,
        annotationSetId: payload.annotationSetId,
        categoryId: payload.categoryId,
        annotatedImageCount: payload.annotatedImageIds.length,
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

    // Only proceed if the project is currently `active` (blocks double launch).
    try {
      await setProjectStatus(payload.projectId, 'launching', {
        status: { eq: 'active' },
      });
    } catch (err: any) {
      const msg = err?.message ?? '';
      const errMsgs = Array.isArray(err?.errors)
        ? err.errors.map((e: any) => e?.message ?? '').join(' ')
        : '';
      if (
        msg.includes('ConditionalCheckFailed') ||
        errMsgs.includes('ConditionalCheckFailed')
      ) {
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

    const result = await handleLaunch(
      payload,
      organizationId,
      workflowLaunchUserId(event.identity)
    );

    if (payloadS3Key) {
      await deletePayloadFromS3(payloadS3Key);
    }

    executeGraphql<{ updateProjectMemberships?: string | null }>(
      updateProjectMembershipsMutation,
      { projectId: payload.projectId }
    ).catch((e) => console.warn('Failed to update project memberships', e));

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error: any) {
    console.error('Error launching Individual ID job', error);
    if (payloadS3Key) {
      await deletePayloadFromS3(payloadS3Key).catch(() => {});
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Failed to launch Individual ID job',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};

async function handleLaunch(
  payload: LaunchIndividualIdPayload,
  organizationId: string,
  launchedBy: string
) {
  const { projectId, annotationSetId, categoryId, categoryName } = payload;
  const annotatedImageIds = new Set(payload.annotatedImageIds);

  if (annotatedImageIds.size === 0) {
    await setProjectStatus(projectId, 'active');
    return { jobId: null, transectCount: 0, message: 'No annotations found' };
  }

  const images = await fetchAllProjectImages(projectId);
  const onEffortImages = images.filter((img) =>
    isOnEffort(img.boundaryStatus)
  );
  const outsideImages = images.filter(
    (img) => !isOnEffort(img.boundaryStatus)
  );
  const hasTransects = onEffortImages.some((img) => img.transectId);

  // imageId -> transectId for every project image.
  const imageToTransect = new Map<string, string>();
  const fanout: Array<{ imageId: string; transectId: string }> = [];

  if (hasTransects) {
    // Reuse existing assignment straight off Image.transectId.
    for (const img of onEffortImages) {
      if (img.transectId) imageToTransect.set(img.id, img.transectId);
    }
  } else {
    // Detect transects from timestamp gaps, create a synthetic stratum + the
    // transect rows, then queue the per-image transectId writes for the SQS
    // fanout consumer (a single lambda would time out on large surveys).
    const assignments = detectTransects(onEffortImages);
    const transectIndexes = Array.from(
      new Set(assignments.map((a) => a.transectIndex))
    ).sort((a, b) => a - b);

    const stratumData = await executeGraphql<{
      createStratum?: { id: string };
    }>(createStratumMutation, {
      input: { projectId, name: 'ChainLinker', group: organizationId },
    });
    const stratumId = stratumData.createStratum?.id;
    if (!stratumId) throw new Error('Failed to create stratum');

    const indexToTransectId = new Map<number, string>();
    const createLimit = pLimit(15);
    await Promise.all(
      transectIndexes.map((idx) =>
        createLimit(async () => {
          const t = await executeGraphql<{ createTransect?: { id: string } }>(
            createTransectMutation,
            { input: { projectId, stratumId, group: organizationId } }
          );
          if (!t.createTransect?.id) throw new Error('Failed to create transect');
          indexToTransectId.set(idx, t.createTransect.id);
        })
      )
    );

    for (const a of assignments) {
      const transectId = indexToTransectId.get(a.transectIndex)!;
      imageToTransect.set(a.id, transectId);
      fanout.push({ imageId: a.id, transectId });
    }
  }

  let outsideTransect: { id: string; fresh: boolean } | null = null;
  if (outsideImages.length > 0) {
    const outside = await ensureOutsideTransect(projectId, organizationId);
    const assigned = assignOutsideImages(outsideImages, outside.transectId);
    for (const [imageId, transectId] of assigned.imageToTransect) {
      imageToTransect.set(imageId, transectId);
    }
    fanout.push(...assigned.fanout);
    outsideTransect = {
      id: outside.transectId,
      fresh: outside.created || assigned.fanout.length > 0,
    };
  }
  const pendingImageUpdates = fanout.length;

  // Transects that contain annotations of this category.
  const transectsWithAnnotations = new Set<string>();
  for (const imageId of annotatedImageIds) {
    const transectId = imageToTransect.get(imageId);
    if (transectId) transectsWithAnnotations.add(transectId);
  }

  if (transectsWithAnnotations.size === 0) {
    await setProjectStatus(projectId, 'active');
    return {
      jobId: null,
      transectCount: 0,
      message: 'No transects contain annotations for this category',
    };
  }

  // Only offer transects that ALSO have at least one registerable neighbour
  // pair — same definition the harness uses (not skipped, both images in the
  // transect, length-9 homography). A transect with annotations but no
  // registerable pairs renders "No registerable pairs", and because the
  // harness completion detector bails when there are no pairs it could never
  // be completed — permanently stranding the job's remaining-transects
  // counter and blocking the whole job from finishing.
  const transectImageMap = new Map<string, string[]>();
  for (const [imgId, tId] of imageToTransect) {
    if (transectsWithAnnotations.has(tId)) {
      const arr = transectImageMap.get(tId);
      if (arr) arr.push(imgId);
      else transectImageMap.set(tId, [imgId]);
    }
  }

  const workTransectIds: string[] = [];
  const filterLimit = pLimit(5);
  await Promise.all(
    Array.from(transectsWithAnnotations).map((tId) =>
      filterLimit(async () => {
        const imgs = transectImageMap.get(tId) ?? [];
        if (await transectHasRegisterablePair(imgs)) {
          workTransectIds.push(tId);
        }
      })
    )
  );

  if (workTransectIds.length === 0) {
    await setProjectStatus(projectId, 'active');
    return {
      jobId: null,
      transectCount: 0,
      message:
        'No transects have registerable pairs for this category (no homography/neighbour data)',
    };
  }

  // Restrict to the transects the client found still-incomplete, so a job
  // never includes transects whose linking is already done. The array is only
  // sent when transects already existed (see payload type); when absent we
  // launch every registerable transect (fresh project, nothing completed).
  let effectiveTransectIds = workTransectIds;
  if (Array.isArray(payload.incompleteTransectIds)) {
    const allow = new Set(payload.incompleteTransectIds);
    if (
      outsideTransect &&
      includeOutsideTransect(payload.includeOutside, outsideTransect.fresh)
    ) {
      allow.add(outsideTransect.id);
    }
    effectiveTransectIds = workTransectIds.filter((id) => allow.has(id));
    if (effectiveTransectIds.length === 0) {
      await setProjectStatus(projectId, 'active');
      return {
        jobId: null,
        transectCount: 0,
        message: 'All transects for this category are already complete',
      };
    }
  }

  const transectCount = effectiveTransectIds.length;
  const jobId = randomUUID();
  await executeGraphql(createIndividualIdJobMutation, {
    input: {
      id: jobId,
      projectId,
      annotationSetId,
      categoryId,
      name: categoryName || 'ChainLinker',
      status: 'launching',
      totalTransects: transectCount,
      remainingTransects: transectCount,
      pendingImageUpdates,
      group: organizationId,
    },
  });

  // The job id doubles as the Workflow Run id: ChainLinker has no Queue, and
  // the job is the durable thing a pair completion belongs to.
  await createShadowWorkflowRun(
    {
      runId: jobId,
      workflowType: 'individual-id',
      projectId,
      annotationSetId,
      displayName: categoryName || 'ChainLinker',
      configuration: {
        categoryId,
        categoryName,
        totalTransects: transectCount,
      },
    },
    { userId: launchedBy, organizationId }
  );

  // Availability rows (only the transects with real, still-incomplete work).
  const rowLimit = pLimit(15);
  await Promise.all(
    effectiveTransectIds.map((transectId) =>
      rowLimit(() =>
        executeGraphql(createIndividualIdTransectMutation, {
          input: {
            jobId,
            projectId,
            annotationSetId,
            categoryId,
            transectId,
            status: 'available',
            group: organizationId,
          },
        })
      )
    )
  );

  if (fanout.length > 0) {
    await fanOutTransectUpdates(fanout, jobId);
  }

  // Warm tiles. skipProjectStamp keeps reconcilePretileLaunches from flipping
  // the project to `active` independently — reconcileIndividualId owns that and
  // additionally waits for the transect-update fanout to drain.
  if (!env.PRETILE_QUEUE_URL) throw new Error('PRETILE_QUEUE_URL not set');
  if (!env.REFRESH_TILES_QUEUE_URL) {
    throw new Error('REFRESH_TILES_QUEUE_URL not set');
  }
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) throw new Error('OUTPUTS_BUCKET_NAME not set');

  const pretileResult = await enqueuePretile({
    projectId,
    annotationSetId,
    workflow: 'individual-id',
    imageIds: Array.from(annotatedImageIds),
    executeGraphql,
    outputsBucket: bucketName,
    queueUrl: env.PRETILE_QUEUE_URL,
    refreshQueueUrl: env.REFRESH_TILES_QUEUE_URL,
    sqsClient,
    s3Client,
    skipProjectStamp: true,
  });

  await executeGraphql(updateIndividualIdJobMutation, {
    input: {
      id: jobId,
      pretileManifestS3Key: pretileResult.manifestKey,
    },
  });

  // Nothing to wait for: no fanout pending AND tiles already fresh. Go active
  // now instead of waiting for the 5-minute reconciler tick.
  if (pendingImageUpdates === 0 && pretileResult.noWorkNeeded) {
    await setProjectStatus(projectId, 'active');
    await executeGraphql(updateIndividualIdJobMutation, {
      input: { id: jobId, status: 'active' },
    });
  }

  console.log('Individual ID job launched', {
    jobId,
    transectCount,
    pendingImageUpdates,
    pretileNoWork: pretileResult.noWorkNeeded,
  });

  return { jobId, transectCount, pendingImageUpdates };
}

async function fetchAllProjectImages(
  projectId: string
): Promise<ProjectImageRow[]> {
  const all: ProjectImageRow[] = [];
  let nextToken: string | null = null;
  do {
    const variables: Record<string, any> = { projectId, limit: 10000 };
    if (nextToken) variables.nextToken = nextToken;
    const res = await executeGraphql<{
      imagesByProjectId?: {
        items: ProjectImageRow[];
        nextToken?: string | null;
      };
    }>(imagesByProjectIdQuery, variables);
    const page = res.imagesByProjectId;
    if (page?.items) all.push(...page.items);
    nextToken = page?.nextToken ?? null;
  } while (nextToken);
  return all;
}

async function fetchAllPages<T>(
  query: string,
  field: string,
  projectId: string
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | null = null;
  do {
    const res: Record<string, { items: T[]; nextToken?: string | null }> =
      await executeGraphql(query, { projectId, limit: 1000, nextToken });
    all.push(...(res[field]?.items ?? []));
    nextToken = res[field]?.nextToken ?? null;
  } while (nextToken);
  return all;
}

// Transect saves delete the outside transect.
async function ensureOutsideTransect(
  projectId: string,
  organizationId: string
): Promise<{ transectId: string; created: boolean }> {
  const strata = await fetchAllPages<{ id: string; offEffort: boolean | null }>(
    strataByProjectIdQuery,
    'strataByProjectId',
    projectId
  );
  let stratumId = strata.find((stratum) => stratum.offEffort)?.id;
  if (!stratumId) {
    const created = await executeGraphql<{ createStratum?: { id: string } }>(
      createStratumMutation,
      {
        input: {
          projectId,
          name: 'Outside boundary',
          offEffort: true,
          group: organizationId,
        },
      }
    );
    stratumId = created.createStratum?.id;
    if (!stratumId) throw new Error('Failed to create outside stratum');
  }
  const transects = await fetchAllPages<{ id: string; stratumId: string }>(
    transectsByProjectIdQuery,
    'transectsByProjectId',
    projectId
  );
  const existing = transects.find(
    (transect) => transect.stratumId === stratumId
  );
  if (existing) return { transectId: existing.id, created: false };
  const created = await executeGraphql<{ createTransect?: { id: string } }>(
    createTransectMutation,
    { input: { projectId, stratumId, group: organizationId } }
  );
  const transectId = created.createTransect?.id;
  if (!transectId) throw new Error('Failed to create outside transect');
  return { transectId, created: true };
}

async function fanOutTransectUpdates(
  fanout: Array<{ imageId: string; transectId: string }>,
  jobId: string
) {
  const queueUrl = env.TRANSECT_UPDATE_QUEUE_URL;
  if (!queueUrl) throw new Error('TRANSECT_UPDATE_QUEUE_URL not set');
  const sqsBatchSize = 10;
  const sendLimit = pLimit(10);
  const tasks: Array<Promise<void>> = [];
  for (let i = 0; i < fanout.length; i += sqsBatchSize) {
    const batch = fanout.slice(i, i + sqsBatchSize);
    const entries = batch.map((item, j) => ({
      Id: `t-${i + j}`,
      MessageBody: JSON.stringify({
        imageId: item.imageId,
        transectId: item.transectId,
        jobId,
      }),
    }));
    tasks.push(
      sendLimit(async () => {
        const resp = await sqsClient.send(
          new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries })
        );
        if (resp.Failed && resp.Failed.length > 0) {
          throw new Error(
            `SQS transect-update batch failed: ${JSON.stringify(resp.Failed)}`
          );
        }
      })
    );
  }
  await Promise.all(tasks);
}

// A transect has work iff at least one ImageNeighbour row has both endpoints
// inside the transect, is not skipped, and carries a length-9 homography —
// exactly the rows the harness turns into registerable pairs. Early-exits as
// soon as one such pair is found.
async function transectHasRegisterablePair(
  imageIds: string[]
): Promise<boolean> {
  if (imageIds.length === 0) return false;
  const imageSet = new Set(imageIds);
  const lim = pLimit(10);
  let found = false;
  await Promise.all(
    imageIds.map((imageId) =>
      lim(async () => {
        if (found) return;
        let nextToken: string | null = null;
        do {
          if (found) return;
          const res: NeighboursByImage1Result =
            await executeGraphql<NeighboursByImage1Result>(
              neighboursByImage1Query,
              { image1Id: imageId, nextToken }
            );
          const page = res.imageNeighboursByImage1key;
          for (const n of page?.items ?? []) {
            if (n.skipped) continue;
            if (!imageSet.has(n.image2Id)) continue;
            if (Array.isArray(n.homography) && n.homography.length === 9) {
              found = true;
              break;
            }
          }
          nextToken = found ? null : page?.nextToken ?? null;
        } while (nextToken);
      })
    )
  );
  return found;
}

function parsePayload(request: unknown): LaunchIndividualIdPayload {
  if (typeof request !== 'string') {
    throw new Error('Launch payload is required');
  }
  const parsed = JSON.parse(request);
  if (parsed?.payloadS3Key) {
    return {
      projectId: '',
      annotationSetId: '',
      categoryId: '',
      annotatedImageIds: [],
      payloadS3Key: parsed.payloadS3Key,
    };
  }
  if (
    !parsed?.projectId ||
    !parsed?.annotationSetId ||
    !parsed?.categoryId ||
    !Array.isArray(parsed?.annotatedImageIds)
  ) {
    throw new Error(
      'Launch payload missing required fields (projectId, annotationSetId, categoryId, annotatedImageIds)'
    );
  }
  return {
    projectId: parsed.projectId,
    annotationSetId: parsed.annotationSetId,
    categoryId: parsed.categoryId,
    categoryName: parsed.categoryName,
    annotatedImageIds: parsed.annotatedImageIds,
    ...(Array.isArray(parsed.incompleteTransectIds)
      ? { incompleteTransectIds: parsed.incompleteTransectIds }
      : {}),
    ...(typeof parsed.includeOutside === 'boolean'
      ? { includeOutside: parsed.includeOutside }
      : {}),
  };
}

async function readPayloadFromS3(
  key: string
): Promise<LaunchIndividualIdPayload> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) throw new Error('OUTPUTS_BUCKET_NAME environment variable not set');
  const res = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: key })
  );
  const body = await res.Body?.transformToString();
  if (!body) throw new Error('Empty payload object in S3');
  const parsed = JSON.parse(body);
  return {
    projectId: parsed.projectId,
    annotationSetId: parsed.annotationSetId,
    categoryId: parsed.categoryId,
    categoryName: parsed.categoryName,
    annotatedImageIds: parsed.annotatedImageIds ?? [],
    ...(Array.isArray(parsed.incompleteTransectIds)
      ? { incompleteTransectIds: parsed.incompleteTransectIds }
      : {}),
    ...(typeof parsed.includeOutside === 'boolean'
      ? { includeOutside: parsed.includeOutside }
      : {}),
  };
}

async function deletePayloadFromS3(key: string): Promise<void> {
  const bucketName = env.OUTPUTS_BUCKET_NAME;
  if (!bucketName) {
    console.warn('OUTPUTS_BUCKET_NAME not set, cannot delete payload');
    return;
  }
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: bucketName, Key: key })
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

async function setProjectStatus(
  projectId: string,
  status: string,
  condition?: { status: { eq: string } }
) {
  await executeGraphql<{ updateProject?: { id: string } }>(
    updateProjectMutation,
    {
      input: { id: projectId, status },
      ...(condition ? { condition } : {}),
    }
  );
}
