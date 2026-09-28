import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/monitorModelProgress';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import {
  listProjects,
  imagesByProjectId,
} from './graphql/queries';
// Return key fields + `group` to avoid nested-resolver auth failures while
// keeping subscription delivery via groupDefinedIn('group') working.
const updateProject = /* GraphQL */ `
  mutation UpdateProject($input: UpdateProjectInput!) {
    updateProject(input: $input) { id group }
  }
`;

// Membership cascade: same pattern launch handlers use. The custom Lambda
// touches every UserProjectMembership / OrganizationMembership with full-scalar
// returns so client subscriptions fire and the UI refreshes the project list.
const updateProjectMembershipsMutation = /* GraphQL */ `
  mutation UpdateProjectMemberships($projectId: String!) {
    updateProjectMemberships(projectId: $projectId)
  }
`;
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

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

interface Project {
  id: string;
  name: string;
  status?: string | null;
  organizationId: string;
  tags?: string[] | null;
}

interface Image {
  id: string;
  projectId: string;
  originalPath: string;
}

interface ImageProcessedByRow {
  imageId: string;
}

interface LocationRow {
  id: string;
}

const processedByProjectIdAndSource = /* GraphQL */ `query ProcessedByProjectIdAndSource(
  $projectId: ID!
  $source: ModelStringKeyConditionInput
  $limit: Int
  $nextToken: String
) {
  processedByProjectIdAndSource(
    projectId: $projectId
    source: $source
    limit: $limit
    nextToken: $nextToken
  ) {
    items {
      imageId
    }
    nextToken
  }
}
`;

const locationsByImageKey = /* GraphQL */ `query LocationsByImageKey(
  $imageId: ID!
  $source: String!
  $limit: Int
  $nextToken: String
) {
  locationsByImageKey(
    imageId: $imageId
    filter: { source: { eq: $source } }
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

const createImageProcessedBy = /* GraphQL */ `mutation CreateImageProcessedBy(
  $input: CreateImageProcessedByInput!
) {
  createImageProcessedBy(input: $input) {
    imageId
    source
    projectId
    group
  }
}
`;

const getRegistrationProgress = /* GraphQL */ `
  query GetRegistrationProgress($projectId: ID!) {
    getRegistrationProgress(projectId: $projectId) {
      projectId
      cleanupState
    }
  }
`;

const registrationProgressByCleanupState = /* GraphQL */ `
  query RegistrationProgressByCleanupState(
    $cleanupState: String!
    $limit: Int
    $nextToken: String
  ) {
    registrationProgressByCleanupState(
      cleanupState: $cleanupState
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        projectId
        pairsCreated
        pairsProcessed
        pendingCount
        lastKickoffAt
        lastChangeAt
        cleanupState
        group
      }
      nextToken
    }
  }
`;

const updateRegistrationProgressStatus = /* GraphQL */ `
  mutation UpdateRegistrationProgressStatus(
    $projectId: ID!
    $cleanupState: String!
    $expected: String!
  ) {
    updateRegistrationProgress(
      input: { projectId: $projectId, cleanupState: $cleanupState }
      condition: { cleanupState: { eq: $expected } }
    ) {
      projectId
      cleanupState
    }
  }
`;

interface RegistrationProgressRow {
  projectId: string;
  pairsCreated?: number | null;
  pairsProcessed?: number | null;
  pendingCount?: number | null;
  lastKickoffAt?: string | null;
  lastChangeAt?: string | null;
  cleanupState?: string | null;
  group?: string | null;
}

const STALE_PROGRESS_MS = 60 * 60 * 1000;

// Null when the depth can't be read; callers then fall back to idle time only.
async function lightglueQueueDepth(): Promise<number | null> {
  const parameterName = process.env.LIGHTGLUE_QUEUE_URL_PARAM;
  if (!parameterName) return null;
  try {
    const parameter = await new SSMClient({ region: env.AWS_REGION }).send(
      new GetParameterCommand({ Name: parameterName })
    );
    const queueUrl = parameter.Parameter?.Value;
    if (!queueUrl) throw new Error(`SSM parameter ${parameterName} is empty`);
    const sqs = new SQSClient({ region: env.AWS_REGION });
    const resp = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
        ],
      })
    );
    const attrs = resp.Attributes ?? {};
    return (
      Number(attrs.ApproximateNumberOfMessages ?? 0) +
      Number(attrs.ApproximateNumberOfMessagesNotVisible ?? 0)
    );
  } catch (e) {
    console.warn('Could not read LightGlue queue depth:', e);
    return null;
  }
}

// Helper function to handle pagination for GraphQL queries
async function fetchAllPages<T, K extends string>(
  queryFn: (
    nextToken?: string
  ) => Promise<GraphQLResult<{ [key in K]: PagedList<T> }>>,
  queryName: K,
  onProgress?: (count: number) => void
): Promise<T[]> {
  const allItems: T[] = [];
  let nextToken: string | undefined;

  do {
    const response = await queryFn(nextToken);
    const items = response.data?.[queryName]?.items ?? [];
    allItems.push(...(items as T[]));
    nextToken = response.data?.[queryName]?.nextToken ?? undefined;

    if (onProgress && allItems.length % 1000 === 0) {
      onProgress(allItems.length);
    }
  } while (nextToken);

  console.log(
    `Completed fetching all ${queryName} pages. Total items: ${allItems.length}`
  );
  return allItems;
}

const LOCATION_PAGE_SIZE = 50;
const LOCATION_LOOKUP_CONCURRENCY = 25;

async function hasLocationForSource(
  imageId: string,
  source: string
): Promise<boolean> {
  let nextToken: string | undefined;

  do {
    const response = (await client.graphql({
      query: locationsByImageKey,
      variables: {
        imageId,
        source,
        limit: LOCATION_PAGE_SIZE,
        nextToken,
      },
    })) as GraphQLResult<{
      locationsByImageKey: PagedList<LocationRow>;
    }>;

    if ((response.data?.locationsByImageKey?.items?.length ?? 0) > 0) {
      return true;
    }

    nextToken =
      response.data?.locationsByImageKey?.nextToken ?? undefined;
  } while (nextToken);

  return false;
}

async function updateProgress(
  project: Project,
  projectImages: Image[],
  source: string
) {
  console.log(
    `Fetching processedBy records for project ${project.id} (source: ${source})`
  );

  const processedByRows = await fetchAllPages<
    ImageProcessedByRow,
    'processedByProjectIdAndSource'
  >(
    (nextToken) =>
      client.graphql({
        query: processedByProjectIdAndSource,
        variables: {
          projectId: project.id,
          source: { eq: source },
          limit: 10000,
          nextToken,
        },
      }) as Promise<
        GraphQLResult<{
          processedByProjectIdAndSource: PagedList<ImageProcessedByRow>;
        }>
      >,
    'processedByProjectIdAndSource'
  );

  const processedImageIds = new Set(
    processedByRows.map((row) => row.imageId)
  );
  const imagesMissingProcessedBy = projectImages.filter(
    (image) => !processedImageIds.has(image.id)
  );
  const imagesToUpdateProcessedBy: Image[] = [];

  console.log(
    `Checking locations for ${imagesMissingProcessedBy.length} images missing ` +
      `a ${source} processedBy record`
  );

  for (
    let i = 0;
    i < imagesMissingProcessedBy.length;
    i += LOCATION_LOOKUP_CONCURRENCY
  ) {
    const batch = imagesMissingProcessedBy.slice(
      i,
      i + LOCATION_LOOKUP_CONCURRENCY
    );
    const results = await Promise.all(
      batch.map(async (image) => ({
        image,
        hasLocation: await hasLocationForSource(image.id, source),
      }))
    );

    for (const result of results) {
      if (result.hasLocation) {
        processedImageIds.add(result.image.id);
        imagesToUpdateProcessedBy.push(result.image);
      }
    }

    console.log(
      `Checked locations for ${Math.min(
        i + batch.length,
        imagesMissingProcessedBy.length
      )}/${imagesMissingProcessedBy.length} unmarked images`
    );
  }

  console.log(
    `Processed images: ${processedImageIds.size}/${projectImages.length}`
  );
  console.log(
    `Images needing processedBy record update: ${imagesToUpdateProcessedBy.length}`
  );

  if (imagesToUpdateProcessedBy.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < imagesToUpdateProcessedBy.length; i += BATCH_SIZE) {
      const batch = imagesToUpdateProcessedBy.slice(i, i + BATCH_SIZE);

      const createPromises = batch.map(async (image) => {
        try {
          await client.graphql({
            query: createImageProcessedBy,
            variables: {
              input: {
                imageId: image.id,
                source: source,
                projectId: project.id,
                group: project.organizationId,
              },
            },
          });
          console.log(`Created processedBy record for image ${image.id}`);
        } catch (error) {
          // Ignore duplicate key errors (record already exists)
          console.warn(`Could not create processedBy record for image ${image.id}:`, error);
        }
      });

      await Promise.all(createPromises);
    }
  }

  const allImagesProcessed =
    projectImages.length > 0 &&
    projectImages.every((image) => processedImageIds.has(image.id));

  if (allImagesProcessed) {
    if (await isRegistrationDone(project.id)) {
      await finalizeProjectActive(project);
    } else {
      console.log(
        `All images processed for project ${project.id}; awaiting registration completion`
      );
      await client.graphql({
        query: updateProject,
        variables: {
          input: { id: project.id, status: 'processing-registration' },
        },
      });
    }
  } else {
    console.log(
      `Project ${project.id} still has ${projectImages.length - processedImageIds.size
      } images to process`
    );
  }
}

// Missing row = no registration work was ever queued (single image, no
// overlaps, etc.) — treat as done so those projects can still activate.
async function isRegistrationDone(projectId: string): Promise<boolean> {
  try {
    const resp = (await client.graphql({
      query: getRegistrationProgress,
      variables: { projectId },
    })) as GraphQLResult<{
      getRegistrationProgress: { cleanupState?: string | null } | null;
    }>;
    const row = resp.data?.getRegistrationProgress;
    return !row || row.cleanupState === 'done';
  } catch (err) {
    console.warn(`isRegistrationDone lookup failed for ${projectId}:`, err);
    return false;
  }
}

async function finalizeProjectActive(project: Project): Promise<void> {
  await client.graphql({
    query: updateProject,
    variables: { input: { id: project.id, status: 'active' } },
  });

  await client.graphql({
    query: updateProjectMembershipsMutation,
    variables: { projectId: project.id },
  });
  console.log(`Successfully updated project ${project.id} status to "active"`);
}

export const handler: Handler = async (event, context) => {
  console.log('Starting monitorModelProgress function execution');
  try {
    console.log('Fetching projects with status "processing"');
    const processingProjects = await fetchAllPages<Project, 'listProjects'>(
      (nextToken) =>
        client.graphql({
          query: listProjects,
          variables: {
            filter: {
              status: {
                contains: 'processing',
              },
            },
            limit: 10000,
            nextToken,
          },
        }) as Promise<GraphQLResult<{ listProjects: PagedList<Project> }>>,
      'listProjects'
    );

    console.log(
      `Found ${processingProjects.length} projects in processing state`
    );

    for (const project of processingProjects) {
      console.log(`Processing project ${project.name} (${project.id})`);

      console.log(`Fetching images for project ${project.id}`);
      const projectImages = await fetchAllPages<Image, 'imagesByProjectId'>(
        (nextToken) =>
          client.graphql({
            query: imagesByProjectId,
            variables: {
              projectId: project.id,
              limit: 10000,
              nextToken,
            },
          }) as Promise<GraphQLResult<{ imagesByProjectId: PagedList<Image> }>>,
        'imagesByProjectId'
      );

      console.log(
        `Found ${projectImages.length} images for project ${project.id}`
      );

      if (project.status?.includes('scoutbot')) {
        console.log(`Project ${project.id} is running scoutbot`);
        await updateProgress(project, projectImages, 'scoutbotv3');
      }

      if (project.status?.includes('mad')) {
        console.log(`Project ${project.id} is running MAD`);
        await updateProgress(project, projectImages, 'mad-v2');
      }

      if (project.status?.includes('stormfly-testing')) {
        console.log(`Project ${project.id} is running Stormfly (testing model)`);
        await updateProgress(project, projectImages, 'stormfly-testing');
      }

      if (project.status?.includes('owl-d')) {
        console.log(`Project ${project.id} is running OWL-D`);
        await updateProgress(project, projectImages, 'owl-d');
      }

      // Finalize elephant detector results reported as pointFinder progress.
      if (project.status?.includes('pointFinder')) {
        console.log(`Project ${project.id} is running pointFinder`);
        await updateProgress(project, projectImages, 'heatmap');
      }

      // Final gate before flipping the project to 'active'. Runs whether the
      // primary model was scoutbot/MAD/Stormfly/heatmap or 'manual' (no model).
      if (project.status?.includes('registration')) {
        if (await isRegistrationDone(project.id)) {
          await finalizeProjectActive(project);
        } else {
          console.log(
            `Project ${project.id} still awaiting registration completion`
          );
        }
      }
    }

    // Decoupled from project.status: registration runs alongside whatever
    // other model the user picked at upload time.
    console.log('Polling RegistrationProgress for projects ready for bucket cleanup');
    const pendingProgress = await fetchAllPages<RegistrationProgressRow, 'registrationProgressByCleanupState'>(
      (nextToken) =>
        client.graphql({
          query: registrationProgressByCleanupState,
          variables: { cleanupState: 'pending', limit: 1000, nextToken },
        }) as Promise<GraphQLResult<{ registrationProgressByCleanupState: PagedList<RegistrationProgressRow> }>>,
      'registrationProgressByCleanupState'
    );

    console.log(`Found ${pendingProgress.length} project(s) with cleanupState='pending'`);

    if (pendingProgress.length > 0) {
      const lambdaClient = new LambdaClient({
        region: env.AWS_REGION,
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          sessionToken: env.AWS_SESSION_TOKEN,
        },
      });

      const now = Date.now();
      let queueDepth: number | null | undefined;
      for (const row of pendingProgress) {
        const pendingCount = row.pendingCount ?? 0;
        const pairsCreated = row.pairsCreated ?? 0;
        const pairsProcessed = row.pairsProcessed ?? 0;
        const lastKickoffMs = row.lastKickoffAt
          ? Date.parse(row.lastKickoffAt)
          : NaN;
        const lastChangeMs = row.lastChangeAt
          ? Date.parse(row.lastChangeAt)
          : NaN;

        // Explicit guard against firing on a never-kicked-off project.
        if (!Number.isFinite(lastKickoffMs)) {
          console.log(
            `Project ${row.projectId}: no lastKickoffAt; skipping`
          );
          continue;
        }

        const idleMs = Number.isFinite(lastChangeMs) ? now - lastChangeMs : Infinity;
        const sinceKickoffMs = now - lastKickoffMs;
        const isReady = pendingCount === 0;
        const isStale =
          pendingCount > 0 &&
          idleMs >= STALE_PROGRESS_MS &&
          sinceKickoffMs >= STALE_PROGRESS_MS;

        // A shared queue that is still draining means backlog, not a stall.
        if (isStale) {
          if (queueDepth === undefined) queueDepth = await lightglueQueueDepth();
          if (queueDepth !== null && queueDepth > 0) {
            console.log(
              `Project ${row.projectId}: idle ${Math.round(idleMs / 60000)}m but LightGlue queue still has ${queueDepth} message(s); not stale`
            );
            continue;
          }
        }

        if (!isReady && !isStale) {
          console.log(
            `Project ${row.projectId}: pendingCount=${pendingCount}, ` +
              `pairsProcessed=${pairsProcessed}/${pairsCreated}; not ready ` +
              `(idle ${Math.round(idleMs / 60000)}m, since kickoff ${Math.round(sinceKickoffMs / 60000)}m)`
          );
          continue;
        }
        if (isStale) {
          console.warn(
            `Project ${row.projectId}: STALE — pendingCount=${pendingCount} ` +
              `but no progress for ${Math.round(idleMs / 60000)}m and last kickoff ` +
              `${Math.round(sinceKickoffMs / 60000)}m ago. Firing cleanup anyway.`
          );
        }

        // CAS pending -> in-progress. Concurrent monitor runs or a fresh
        // runImageRegistration kickoff lose the race and are skipped here.
        try {
          await client.graphql({
            query: updateRegistrationProgressStatus,
            variables: {
              projectId: row.projectId,
              cleanupState: 'in-progress',
              expected: 'pending',
            },
          });
        } catch (e) {
          console.log(
            `Skipping ${row.projectId}: flip to in-progress failed (CAS lost or transient error):`,
            e
          );
          continue;
        }

        try {
          await lambdaClient.send(
            new InvokeCommand({
              FunctionName: env.REGISTRATION_BUCKET_CLEANUP_FUNCTION_NAME,
              InvocationType: 'Event',
              Payload: Buffer.from(JSON.stringify({ projectId: row.projectId })),
            })
          );
          console.log(`Invoked registrationBucketCleanup for project ${row.projectId}`);
        } catch (invokeErr) {
          console.error(
            `Failed to invoke registrationBucketCleanup for ${row.projectId}, rolling back state:`,
            invokeErr
          );
          // Roll back so the next monitor pass retries.
          try {
            await client.graphql({
              query: updateRegistrationProgressStatus,
              variables: {
                projectId: row.projectId,
                cleanupState: 'pending',
                expected: 'in-progress',
              },
            });
          } catch (rollbackErr) {
            console.error(`Rollback of state failed for ${row.projectId}:`, rollbackErr);
          }
        }
      }
    }

    console.log('Project status monitoring completed successfully');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Project status monitoring completed successfully',
      }),
    };
  } catch (error: any) {
    console.error('Error in monitorModelProgress:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error monitoring project status',
        error: error.message,
      }),
    };
  }
};
