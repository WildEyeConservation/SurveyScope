import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/reconcileIndividualId';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import pLimit from 'p-limit';
import { loadImageTileStates } from '../shared/loadImageTileStates';

// Safety net only: if a per-image decrement is permanently lost (SQS message
// dropped after the image write but before the counter update), the fanout
// counter would never reach 0. After this long, provided pretiling is also
// done, complete the launch anyway — the images were written by the
// at-least-once fanout regardless of the counter.
const LAUNCH_DEADLINE_MS = 90 * 60 * 1000;

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

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

const listIndividualIdJobsQuery = /* GraphQL */ `
  query ListIndividualIdJobs($nextToken: String) {
    listIndividualIdJobs(limit: 500, nextToken: $nextToken) {
      items {
        id
        projectId
        status
        pendingImageUpdates
        pretileManifestS3Key
        createdAt
      }
      nextToken
    }
  }
`;

const updateProjectMutation = /* GraphQL */ `
  mutation UpdateProject($input: UpdateProjectInput!) {
    updateProject(input: $input) { id group }
  }
`;

const updateIndividualIdJobMutation = /* GraphQL */ `
  mutation UpdateIndividualIdJob($input: UpdateIndividualIdJobInput!) {
    updateIndividualIdJob(input: $input) { id group }
  }
`;

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

type JobRow = {
  id: string;
  projectId: string;
  status: string | null;
  pendingImageUpdates: number | null;
  pretileManifestS3Key: string | null;
  createdAt: string;
};

type PretileManifest = {
  launchId: string;
  projectId: string;
  imageIds: string[];
  createdAt: string;
};

type ListJobsResult = {
  listIndividualIdJobs: { items: JobRow[]; nextToken?: string | null };
};

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const resp = (await client.graphql({
    query,
    variables,
  } as any)) as GraphQLResult<T>;
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(resp.errors.map((e) => e.message))}`
    );
  }
  if (!resp.data) throw new Error('GraphQL response missing data');
  return resp.data;
}

async function listLaunchingJobs(): Promise<JobRow[]> {
  const all: JobRow[] = [];
  let nextToken: string | null = null;
  do {
    const data: ListJobsResult = await executeGraphql<ListJobsResult>(
      listIndividualIdJobsQuery,
      { nextToken }
    );
    all.push(...data.listIndividualIdJobs.items);
    nextToken = data.listIndividualIdJobs.nextToken ?? null;
  } while (nextToken);
  return all.filter((j) => j.status === 'launching');
}

async function loadManifest(key: string): Promise<PretileManifest | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: env.OUTPUTS_BUCKET_NAME, Key: key })
    );
    const body = await resp.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as PretileManifest;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NoSuchKey') return null;
    throw err;
  }
}

async function allImagesTiled(
  projectId: string,
  imageIds: string[],
  manifestCreatedAt: string
): Promise<boolean> {
  if (imageIds.length === 0) return true;
  const createdAtMs = Date.parse(manifestCreatedAt);
  const states = await loadImageTileStates(projectId, imageIds, executeGraphql);
  return imageIds.every((id) => {
    const tiledAt = states.get(id)?.tiledAt;
    if (!tiledAt) return false;
    const tiledAtMs = Date.parse(tiledAt);
    return Number.isFinite(tiledAtMs) && tiledAtMs >= createdAtMs;
  });
}

async function completeLaunch(job: JobRow): Promise<void> {
  await executeGraphql(updateProjectMutation, {
    input: { id: job.projectId, status: 'active' },
  });
  await executeGraphql(updateIndividualIdJobMutation, {
    input: { id: job.id, status: 'active', pretileManifestS3Key: null },
  });
  if (job.pretileManifestS3Key) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: env.OUTPUTS_BUCKET_NAME,
          Key: job.pretileManifestS3Key,
        })
      );
    } catch (err) {
      console.warn('manifest delete failed', err);
    }
  }
  try {
    await executeGraphql(updateProjectMembershipsMutation, {
      projectId: job.projectId,
    });
  } catch (err) {
    console.warn('updateProjectMemberships failed', err);
  }
}

export const handler: Handler = async () => {
  const startedAt = Date.now();
  const jobs = await listLaunchingJobs();
  console.log(
    JSON.stringify({ msg: 'reconcile_iid_start', launchingCount: jobs.length })
  );

  const jobLimit = pLimit(5);
  const results = await Promise.all(
    jobs.map((job) =>
      jobLimit(async () => {
        // Pretile gate.
        let pretileDone: boolean;
        if (!job.pretileManifestS3Key) {
          pretileDone = true; // nothing to tile (all fresh)
        } else {
          const manifest = await loadManifest(job.pretileManifestS3Key);
          if (!manifest) {
            pretileDone = true; // manifest gone — treat as done
          } else {
            pretileDone = await allImagesTiled(
              job.projectId,
              manifest.imageIds,
              manifest.createdAt
            );
          }
        }

        const fanoutDone = (job.pendingImageUpdates ?? 0) <= 0;
        const createdMs = Date.parse(job.createdAt);
        const deadlineExceeded =
          Number.isFinite(createdMs) &&
          Date.now() - createdMs > LAUNCH_DEADLINE_MS;

        if (pretileDone && (fanoutDone || deadlineExceeded)) {
          await completeLaunch(job);
          return {
            job: job.id,
            action: 'completed',
            fanoutDone,
            deadlineExceeded,
          };
        }
        return {
          job: job.id,
          action: 'still-waiting',
          pretileDone,
          fanoutDone,
        };
      })
    )
  );

  console.log(
    JSON.stringify({
      msg: 'reconcile_iid_done',
      elapsedMs: Date.now() - startedAt,
      summary: results,
    })
  );
};
