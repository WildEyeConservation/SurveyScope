import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/extendTileLifecycles';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import pLimit from 'p-limit';

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
const sqs = new SQSClient({ region: env.AWS_REGION });

// ── GraphQL ──

const listProjectsQuery = /* GraphQL */ `
  query ListProjects($nextToken: String) {
    listProjects(limit: 500, nextToken: $nextToken) {
      items {
        id
        status
        pretileManifestS3Key
        organizationId
        tags
      }
      nextToken
    }
  }
`;

const queuesByProjectIdQuery = /* GraphQL */ `
  query QueuesByProjectId($projectId: ID!, $nextToken: String) {
    queuesByProjectId(projectId: $projectId, limit: 500, nextToken: $nextToken) {
      items {
        id
        hidden
        lastObservationAt
        lastAccessedAt
      }
      nextToken
    }
  }
`;

const imagesByProjectIdQuery = /* GraphQL */ `
  query ImagesByProjectId($projectId: ID!, $nextToken: String, $filter: ModelImageFilterInput) {
    imagesByProjectId(projectId: $projectId, limit: 500, nextToken: $nextToken, filter: $filter) {
      items {
        id
        originalPath
        tiledAt
      }
      nextToken
    }
  }
`;

// ── Types ──

type ProjectRow = {
  id: string;
  status: string | null;
  pretileManifestS3Key: string | null;
  organizationId: string;
  tags: string[] | null;
};

type QueueRow = {
  id: string;
  hidden: boolean | null;
  lastObservationAt: string | null;
  lastAccessedAt: string | null;
};

type ImageRow = {
  id: string;
  originalPath: string | null;
  tiledAt: string | null;
};

// ── Helpers ──

type ListProjectsResult = {
  listProjects: { items: ProjectRow[]; nextToken?: string | null };
};

type ListQueuesResult = {
  queuesByProjectId: { items: QueueRow[]; nextToken?: string | null };
};

type ListImagesResult = {
  imagesByProjectId: { items: ImageRow[]; nextToken?: string | null };
};

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

async function listActiveProjects(): Promise<ProjectRow[]> {
  const all: ProjectRow[] = [];
  let nextToken: string | null = null;
  do {
    const data: ListProjectsResult = await executeGraphql<ListProjectsResult>(
      listProjectsQuery, { nextToken }
    );
    all.push(...data.listProjects.items);
    nextToken = data.listProjects.nextToken ?? null;
  } while (nextToken);
  return all.filter(
    (p) => p.status === 'active' && !p.pretileManifestS3Key
  );
}

async function getProjectQueues(projectId: string): Promise<QueueRow[]> {
  const all: QueueRow[] = [];
  let nextToken: string | null = null;
  do {
    const data: ListQueuesResult = await executeGraphql<ListQueuesResult>(
      queuesByProjectIdQuery, { projectId, nextToken }
    );
    all.push(...data.queuesByProjectId.items);
    nextToken = data.queuesByProjectId.nextToken ?? null;
  } while (nextToken);
  return all;
}

async function getExpiringImages(
  projectId: string,
  lowerBound: string,
  upperBound: string
): Promise<ImageRow[]> {
  const all: ImageRow[] = [];
  let nextToken: string | null = null;
  do {
    const data: ListImagesResult = await executeGraphql<ListImagesResult>(
      imagesByProjectIdQuery, {
        projectId,
        nextToken,
        filter: {
          tiledAt: { between: [lowerBound, upperBound] },
        },
      }
    );
    all.push(...data.imagesByProjectId.items);
    nextToken = data.imagesByProjectId.nextToken ?? null;
  } while (nextToken);
  return all;
}

function isRecentlyActive(queues: QueueRow[], cutoffMs: number): boolean {
  return queues.some((q) => {
    if (q.hidden) return false;
    return [q.lastObservationAt, q.lastAccessedAt].some(
      (time) => !!time && Date.parse(time) > cutoffMs
    );
  });
}

function buildImageKeyPrefix(project: ProjectRow): string {
  const isLegacy = project.tags?.includes('legacy') ?? false;
  return isLegacy
    ? 'images/'
    : `images/${project.organizationId}/${project.id}/`;
}

async function enqueueRefresh(
  images: ImageRow[],
  project: ProjectRow,
  manifestCreatedAt: string
): Promise<number> {
  if (images.length === 0) return 0;
  const queueUrl = env.REFRESH_TILES_QUEUE_URL;
  const prefix = buildImageKeyPrefix(project);
  const batchSize = 10;
  const sendLimit = pLimit(10);
  const tasks: Promise<void>[] = [];
  let enqueued = 0;

  for (let i = 0; i < images.length; i += batchSize) {
    const batch = images.slice(i, i + batchSize);
    const entries = batch
      .filter((img) => img.originalPath)
      .map((img, j) => ({
        Id: `ext-${i + j}`,
        MessageBody: JSON.stringify({
          imageId: img.id,
          sourceKey: `${prefix}${img.originalPath}`,
          manifestCreatedAt,
        }),
      }));
    if (entries.length === 0) continue;
    tasks.push(
      sendLimit(async () => {
        const resp = await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: entries,
          })
        );
        if (resp.Failed && resp.Failed.length > 0) {
          console.error(
            JSON.stringify({
              msg: 'extend_enqueue_failed',
              projectId: project.id,
              failed: resp.Failed,
            })
          );
        }
        enqueued += entries.length - (resp.Failed?.length ?? 0);
      })
    );
  }
  await Promise.all(tasks);
  return enqueued;
}

// ── Handler ──

const ACTIVITY_WINDOW_DAYS = 14;
const TILE_AGE_LOWER_DAYS = 45;
const TILE_AGE_UPPER_DAYS = 60;

export const handler: Handler = async () => {
  const startedAt = Date.now();
  const now = new Date();
  const manifestCreatedAt = now.toISOString();
  const activityCutoff = startedAt - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lowerBound = new Date(
    startedAt - TILE_AGE_UPPER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const upperBound = new Date(
    startedAt - TILE_AGE_LOWER_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const projects = await listActiveProjects();
  console.log(
    JSON.stringify({
      msg: 'extend_start',
      activeProjectCount: projects.length,
      lowerBound,
      upperBound,
    })
  );

  const projectLimit = pLimit(5);
  const results = await Promise.all(
    projects.map((project) =>
      projectLimit(async () => {
        const queues = await getProjectQueues(project.id);
        if (!isRecentlyActive(queues, activityCutoff)) {
          return { projectId: project.id, action: 'inactive' };
        }

        const images = await getExpiringImages(project.id, lowerBound, upperBound);
        if (images.length === 0) {
          return { projectId: project.id, action: 'no-expiring-images' };
        }

        const enqueued = await enqueueRefresh(images, project, manifestCreatedAt);
        return {
          projectId: project.id,
          action: 'enqueued',
          imageCount: images.length,
          enqueued,
        };
      })
    )
  );

  console.log(
    JSON.stringify({
      msg: 'extend_done',
      elapsedMs: Date.now() - startedAt,
      summary: results,
    })
  );
};
