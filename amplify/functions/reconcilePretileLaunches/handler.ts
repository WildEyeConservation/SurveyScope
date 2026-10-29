import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/reconcilePretileLaunches';
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

// ── GraphQL ──

const listProjectsQuery = /* GraphQL */ `
  query ListProjects($nextToken: String) {
    listProjects(limit: 500, nextToken: $nextToken) {
      items {
        id
        status
        pretileManifestS3Key
      }
      nextToken
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

const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;

// ── Types ──

type ProjectRow = {
  id: string;
  status: string | null;
  pretileManifestS3Key: string | null;
};

type PretileManifest = {
  launchId: string;
  projectId: string;
  annotationSetId: string | null;
  workflow: string;
  imageIds: string[];
  createdAt: string;
};

// ── Helpers ──

async function executeGraphql<T>(
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const resp = (await client.graphql({ query, variables } as any)) as GraphQLResult<T>;
  if (resp.errors && resp.errors.length > 0) {
    throw new Error(
      `GraphQL error: ${JSON.stringify(resp.errors.map((e) => e.message))}`
    );
  }
  if (!resp.data) throw new Error('GraphQL response missing data');
  return resp.data;
}

type ListProjectsResult = {
  listProjects: { items: ProjectRow[]; nextToken?: string | null };
};

async function listInflightProjects(): Promise<ProjectRow[]> {
  // Filter client-side after listing. listProjects filter inputs don't support
  // `attributeExists` reliably in Amplify Gen 2, and the project table is small
  // enough to scan.
  const all: ProjectRow[] = [];
  let nextToken: string | null = null;
  do {
    const data: ListProjectsResult = await executeGraphql<ListProjectsResult>(
      listProjectsQuery,
      { nextToken }
    );
    all.push(...data.listProjects.items);
    nextToken = data.listProjects.nextToken ?? null;
  } while (nextToken);
  return all.filter((p) => !!p.pretileManifestS3Key);
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

type UntiledReason = 'missing' | 'no-tiledAt' | 'stale';

type ImageStatusSummary = {
  done: boolean;
  total: number;
  doneCount: number;
  missingCount: number;
  noTiledAtCount: number;
  staleTiledAtCount: number;
  sample: Array<{ id: string; reason: UntiledReason; tiledAt?: string | null }>;
};

async function inspectImageStatus(
  projectId: string,
  imageIds: string[],
  manifestCreatedAt: string,
  sampleSize = 20
): Promise<ImageStatusSummary> {
  const total = imageIds.length;
  if (total === 0) {
    return {
      done: true,
      total: 0,
      doneCount: 0,
      missingCount: 0,
      noTiledAtCount: 0,
      staleTiledAtCount: 0,
      sample: [],
    };
  }
  // An image counts as "done for this launch" only if its tiledAt is AFTER
  // the launch manifest was created. A tiledAt at/before manifestCreatedAt
  // means the stamp is stale (left over from a previous launch); workers
  // still need to touch the S3 tiles for this launch.
  const createdAtMs = Date.parse(manifestCreatedAt);
  const states = await loadImageTileStates(projectId, imageIds, executeGraphql);
  let doneCount = 0;
  let missingCount = 0;
  let noTiledAtCount = 0;
  let staleTiledAtCount = 0;
  const sample: ImageStatusSummary['sample'] = [];
  for (const id of imageIds) {
    const state = states.get(id);
    if (!state) {
      missingCount++;
      if (sample.length < sampleSize) sample.push({ id, reason: 'missing' });
      continue;
    }
    const tiledAt = state.tiledAt;
    if (!tiledAt) {
      noTiledAtCount++;
      if (sample.length < sampleSize)
        sample.push({ id, reason: 'no-tiledAt', tiledAt: null });
      continue;
    }
    const tiledAtMs = Date.parse(tiledAt);
    if (!Number.isFinite(tiledAtMs) || tiledAtMs < createdAtMs) {
      staleTiledAtCount++;
      if (sample.length < sampleSize)
        sample.push({ id, reason: 'stale', tiledAt });
      continue;
    }
    doneCount++;
  }
  return {
    done: missingCount + noTiledAtCount + staleTiledAtCount === 0,
    total,
    doneCount,
    missingCount,
    noTiledAtCount,
    staleTiledAtCount,
    sample,
  };
}

async function completeLaunch(project: ProjectRow, manifestKey: string) {
  await executeGraphql(updateProjectMutation, {
    input: {
      id: project.id,
      status: 'active',
      pretileManifestS3Key: null,
    },
  });
  try {
    await executeGraphql(updateProjectMembershipsMutation, {
      projectId: project.id,
    });
  } catch (err) {
    console.warn('updateProjectMemberships failed', err);
  }
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: env.OUTPUTS_BUCKET_NAME,
        Key: manifestKey,
      })
    );
  } catch (err) {
    console.warn('manifest delete failed', err);
  }
}

// ── Handler ──

export const handler: Handler = async () => {
  const startedAt = Date.now();
  const projects = await listInflightProjects();
  console.log(
    JSON.stringify({
      msg: 'reconcile_start',
      inflightCount: projects.length,
    })
  );

  const projectLimit = pLimit(5);
  const results = await Promise.all(
    projects.map((project) =>
      projectLimit(async () => {
        if (!project.pretileManifestS3Key) {
          return { project: project.id, action: 'no-key' };
        }
        const manifest = await loadManifest(project.pretileManifestS3Key);
        if (!manifest) {
          console.warn('manifest missing, clearing pointer', {
            projectId: project.id,
            key: project.pretileManifestS3Key,
          });
          await executeGraphql(updateProjectMutation, {
            input: {
              id: project.id,
              status: 'active',
              pretileManifestS3Key: null,
            },
          });
          return { project: project.id, action: 'manifest-missing' };
        }

        const summary = await inspectImageStatus(
          project.id,
          manifest.imageIds,
          manifest.createdAt
        );
        if (summary.done) {
          await completeLaunch(project, project.pretileManifestS3Key);
          return {
            project: project.id,
            action: 'completed',
            imageCount: manifest.imageIds.length,
          };
        }

        return {
          project: project.id,
          action: 'still-waiting',
          launchId: manifest.launchId,
          manifestCreatedAt: manifest.createdAt,
          imageCount: manifest.imageIds.length,
          progress: {
            done: summary.doneCount,
            missing: summary.missingCount,
            noTiledAt: summary.noTiledAtCount,
            stale: summary.staleTiledAtCount,
          },
          untiledSample: summary.sample,
        };
      })
    )
  );

  console.log(
    JSON.stringify({
      msg: 'reconcile_done',
      elapsedMs: Date.now() - startedAt,
      summary: results,
    })
  );
};
