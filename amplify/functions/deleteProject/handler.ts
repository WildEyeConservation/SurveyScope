import { env } from '$amplify/env/deleteProject';
import { Amplify } from 'aws-amplify';
import type { DeleteProjectInFullHandler } from '../../data/resource';
import { assertSysadmin, authorizeRequest } from '../shared/authorizeRequest';
import { getProject, listProjects, listObjects } from './graphql/queries';
import { generateClient, GraphQLResult } from 'aws-amplify/data';
import { SQSClient } from '@aws-sdk/client-sqs';
import { authorizeSurveyAdmin } from '../shared/authorizeSurveyAdmin';
import { deleteBoundQueue } from '../shared/queueNames';
import type { Project, Object as ObjectRow } from './graphql/API';

const deleteUserProjectMembership = /* GraphQL */ `
  mutation DeleteUserProjectMembership($input: DeleteUserProjectMembershipInput!) {
    deleteUserProjectMembership(input: $input) {
      id
      userId
      projectId
      isAdmin
      queueId
      backupQueueId
      group
      createdAt
      updatedAt
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

const client = generateClient({
  authMode: 'iam',
});

interface PagedList<T> {
  items: T[];
  nextToken: string | null | undefined;
}

// Helper function to handle pagination for GraphQL queries
async function fetchAllPages<T, K extends string>(
  queryFn: (
    nextToken?: string
  ) => Promise<GraphQLResult<{ [key in K]: PagedList<T> }>>,
  queryName: K
): Promise<T[]> {
  const allItems: T[] = [];
  let nextToken: string | undefined;

  do {
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

async function executeGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = (await client.graphql({ query, variables } as any)) as GraphQLResult<T>;
  if (response.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(response.errors.map((e) => e.message))}`);
  }
  if (!response.data) throw new Error('GraphQL response missing data');
  return response.data;
}

type Row = Record<string, string>;
interface DeleteSpec {
  model: string;
  keys: string[];
}

const spec = (model: string, ...keys: string[]): DeleteSpec => ({
  model,
  keys: keys.length ? keys : ['id'],
});

const CONCURRENCY = 25;

async function mapLimit<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    }),
  );
}

type ErrorLike = { message?: string; errors?: { message?: string }[] };

function errorMessage(error: unknown): string {
  const e = (error ?? {}) as ErrorLike;
  return [e.message, ...(e.errors ?? []).map((inner) => inner?.message)]
    .filter(Boolean)
    .join('; ');
}

const isAlreadyGone = (error: unknown) =>
  /conditional request failed|ConditionalCheckFailed/i.test(
    errorMessage(error),
  );

async function listRows(
  field: string,
  arg: string,
  value: string,
  select: string[],
  filter?: { type: string; value: Record<string, unknown> },
): Promise<Row[]> {
  const query = /* GraphQL */ `
    query ${field[0].toUpperCase()}${field.slice(1)}(
      $${arg}: ID!
      $nextToken: String
      ${filter ? `$filter: ${filter.type}` : ''}
    ) {
      ${field}(
        ${arg}: $${arg}
        nextToken: $nextToken
        limit: 1000
        ${filter ? 'filter: $filter' : ''}
      ) {
        items { ${select.join(' ')} }
        nextToken
      }
    }
  `;
  return fetchAllPages<Row, string>(
    (nextToken) =>
      client.graphql({
        query,
        variables: { [arg]: value, nextToken, filter: filter?.value },
      }) as Promise<GraphQLResult<Record<string, PagedList<Row>>>>,
    field,
  );
}

// Rows already gone are skipped.
async function deleteRows(target: DeleteSpec, rows: Row[]): Promise<void> {
  const query = /* GraphQL */ `
    mutation Delete${target.model}($input: Delete${target.model}Input!) {
      delete${target.model}(input: $input) { ${target.keys.join(' ')} }
    }
  `;
  await mapLimit(rows, async (row) => {
    const input = Object.fromEntries(target.keys.map((k) => [k, row[k]]));
    try {
      await client.graphql({ query, variables: { input } });
    } catch (error) {
      if (!isAlreadyGone(error)) throw error;
    }
  });
}

async function sweep(
  target: DeleteSpec,
  field: string,
  arg: string,
  value: string,
  filter?: { type: string; value: Record<string, unknown> },
): Promise<Row[]> {
  const rows = await listRows(field, arg, value, target.keys, filter);
  await deleteRows(target, rows);
  return rows;
}

// Steps in a phase run independently; the caller throws if any failed.
async function runSteps(
  steps: [string, () => Promise<void>][],
): Promise<string[]> {
  const errors: string[] = [];
  for (const [name, fn] of steps) {
    try {
      await fn();
    } catch (error) {
      console.error(`Cleanup step "${name}" failed:`, error);
      errors.push(`${name}: ${errorMessage(error)}`);
    }
  }
  return errors;
}

const SHARE_CHILDREN: [DeleteSpec, string][] = [
  [spec('SharedChainAnnotation'), 'sharedChainAnnotationsByShareId'],
  [spec('SharedChainImage'), 'sharedChainImagesByShareId'],
  [spec('SharedChainLocation'), 'sharedChainLocationsByShareId'],
  [spec('SharedChainNeighbour'), 'sharedChainNeighboursByShareId'],
  [spec('SharedChainCategory'), 'sharedChainCategoriesByShareId'],
  [spec('ChainReviewFeedback'), 'chainReviewFeedbackByShareId'],
];

// Rows found through an index on the project, annotation sets or members.
async function deleteIndexedSurveyRows(
  projectId: string,
  annotationSetIds: string[],
  userIds: string[],
): Promise<string[]> {
  const byProject = (
    target: DeleteSpec,
    field: string,
    arg = 'projectId',
  ): [string, () => Promise<void>] => [
    target.model,
    async () => {
      await sweep(target, field, arg, projectId);
    },
  ];

  return runSteps([
    byProject(
      spec('ResultSharingToken', 'surveyId', 'annotationSetId'),
      'listResultSharingTokens',
      'surveyId',
    ),
    byProject(
      spec('JollyResultsMembership', 'surveyId', 'annotationSetId', 'userId'),
      'jollyResultsMembershipsBySurveyId',
      'surveyId',
    ),
    byProject(
      spec(
        'JollyResult',
        'surveyId',
        'stratumId',
        'annotationSetId',
        'categoryId',
      ),
      'jollyResultsBySurveyId',
      'surveyId',
    ),
    [
      'ChainShare',
      async () => {
        for (const setId of annotationSetIds) {
          const shares = (
            await listRows(
              'chainSharesByAnnotationSetId',
              'annotationSetId',
              setId,
              ['shareId', 'surveyId'],
            )
          ).filter((share) => share.surveyId === projectId);
          for (const { shareId } of shares) {
            for (const [child, field] of SHARE_CHILDREN) {
              await sweep(child, field, 'shareId', shareId);
            }
          }
          await deleteRows(spec('ChainShare', 'shareId'), shares);
        }
      },
    ],
    [
      'IndividualIdJob',
      async () => {
        await sweep(
          spec('IndividualIdTransect'),
          'individualIdTransectsByProjectId',
          'projectId',
          projectId,
        );
        await sweep(
          spec('IndividualIdJob'),
          'individualIdJobsByProjectId',
          'projectId',
          projectId,
        );
      },
    ],
    [
      'TilingTask',
      async () => {
        const tasks = await listRows(
          'tilingTasksByProjectId',
          'projectId',
          projectId,
          ['id'],
        );
        for (const task of tasks) {
          await sweep(
            spec('TilingBatch'),
            'tilingBatchesByTaskId',
            'tilingTaskId',
            task.id,
          );
        }
        await deleteRows(spec('TilingTask'), tasks);
      },
    ],
    [
      'Queue',
      async () => {
        const queues = await listRows(
          'queuesByProjectId',
          'projectId',
          projectId,
          ['id', 'url'],
        );
        // Without its row nothing could find the SQS queue later.
        const sqs = new SQSClient({});
        await mapLimit(queues, async (queue) => {
          await deleteBoundQueue(
            sqs,
            { id: queue.id, url: queue.url, projectId },
            executeGraphql,
          );
        });
        await deleteRows(spec('Queue'), queues);
      },
    ],
    [
      'ProjectTestConfig',
      async () => {
        await deleteRows(spec('ProjectTestConfig', 'projectId'), [
          { projectId },
        ]);
      },
    ],
    [
      'RegistrationProgress',
      async () => {
        await deleteRows(spec('RegistrationProgress', 'projectId'), [
          { projectId },
        ]);
      },
    ],
    byProject(
      spec('RegistrationBucketStat', 'projectId', 'bucketKey'),
      'registrationBucketStatsByProjectId',
    ),
    byProject(spec('Shapefile'), 'shapefilesByProjectId'),
    byProject(spec('ShapefileExclusions'), 'shapefileExclusionsByProjectId'),
    byProject(
      spec('CameraOverlap', 'cameraAId', 'cameraBId'),
      'cameraOverlapsByProjectId',
    ),
    byProject(spec('Camera'), 'camerasByProjectId'),
    byProject(spec('Transect'), 'transectsByProjectId'),
    byProject(spec('Stratum'), 'strataByProjectId'),
    [
      'TestResult',
      async () => {
        // Only indexed by user, so this covers the survey's members.
        for (const userId of new Set(userIds)) {
          const results = await listRows(
            'testResultsByUserId',
            'userId',
            userId,
            ['id'],
            {
              type: 'ModelTestResultFilterInput',
              value: { projectId: { eq: projectId } },
            },
          );
          for (const result of results) {
            await sweep(
              spec('TestResultCategoryCount', 'testResultId', 'categoryName'),
              'listTestResultCategoryCounts',
              'testResultId',
              result.id,
            );
          }
          await deleteRows(spec('TestResult'), results);
        }
      },
    ],
    byProject(
      spec('UserStats', 'projectId', 'userId', 'date', 'setId'),
      'listUserStats',
    ),
    [
      'Observation',
      async () => {
        for (const setId of annotationSetIds) {
          await sweepOwned(
            spec('Observation'),
            'observationsByAnnotationSetId',
            'annotationSetId',
            setId,
            projectId,
          );
        }
      },
    ],
    byProject(
      spec('ImageProcessedBy', 'imageId', 'source'),
      'processedByProjectIdAndSource',
    ),
    byProject(
      spec('ImageNeighbour', 'image1Id', 'image2Id'),
      'imageNeighboursByProjectId',
    ),
  ]);
}

// Location-scoped rows (no project index) and extra image sets.
async function deleteLocationChildren(
  projectId: string,
  locationIds: string[],
  annotationSetIds: string[],
  // Only test locations carry answer counts.
  testLocationIds: string[],
): Promise<string[]> {
  return runSteps([
    [
      'LocationAnnotationCount',
      () =>
        mapLimit(testLocationIds, async (locationId) => {
          await sweep(
            spec(
              'LocationAnnotationCount',
              'locationId',
              'categoryId',
              'annotationSetId',
            ),
            'categoryCountsByLocationIdAndAnnotationSetId',
            'locationId',
            locationId,
          );
        }),
    ],
    [
      'TestPresetLocation',
      async () => {
        const links = await listRows(
          'testPresetsByProjectId',
          'projectId',
          projectId,
          ['testPresetId', 'projectId'],
        );
        const owned = await listRows(
          'testPresetsByOwnerProjectId',
          'ownerProjectId',
          projectId,
          ['id'],
        );
        const presetIds = new Set([
          ...links.map((l) => l.testPresetId),
          ...owned.map((p) => p.id),
        ]);
        const locationSet = new Set(locationIds);
        const setIds = new Set(annotationSetIds);
        for (const presetId of presetIds) {
          const rows = (
            await listRows(
              'locationsByTestPresetId',
              'testPresetId',
              presetId,
              ['testPresetId', 'locationId', 'annotationSetId'],
            )
          ).filter(
            (r) =>
              locationSet.has(r.locationId) || setIds.has(r.annotationSetId),
          );
          await deleteRows(
            spec(
              'TestPresetLocation',
              'testPresetId',
              'locationId',
              'annotationSetId',
            ),
            rows,
          );
        }
        await deleteRows(
          spec('TestPresetProject', 'testPresetId', 'projectId'),
          links,
        );
      },
    ],
    [
      'ImageSet',
      async () => {
        const imageSets = await listRows(
          'imageSetsByProjectId',
          'projectId',
          projectId,
          ['id'],
        );
        for (const set of imageSets) {
          await sweep(
            spec('ImageSetMembership'),
            'imageSetMembershipsByImageSetId',
            'imageSetId',
            set.id,
          );
        }
        await deleteRows(spec('ImageSet'), imageSets);
      },
    ],
  ]);
}

const setProjectDeleting = /* GraphQL */ `
  mutation SetProjectDeleting($input: UpdateProjectInput!) {
    updateProject(input: $input) { id group }
  }
`;

// Rows found by a set or image index are kept unless they name this survey.
async function sweepOwned(
  target: DeleteSpec,
  field: string,
  arg: string,
  value: string,
  projectId: string,
): Promise<void> {
  const rows = await listRows(field, arg, value, [
    ...new Set([...target.keys, 'projectId']),
  ]);
  await deleteRows(
    target,
    rows.filter((row) => row.projectId === projectId),
  );
}

function failIfAny(phase: string, errors: string[]) {
  if (errors.length) {
    throw new Error(`Incomplete cleanup (${phase}): ${errors.join(' | ')}`);
  }
}

// Logs whether another survey in the organisation names the same image set.
async function logS3Sharing(
  projectId: string,
  organizationId: string,
  imageSetNames: Set<string>,
) {
  const projects = await fetchAllPages<Project, 'listProjects'>(
    (nextToken) =>
      client.graphql({
        query: listProjects,
        variables: { filter: { organizationId: { eq: organizationId } }, nextToken },
      }) as Promise<GraphQLResult<{ listProjects: PagedList<Project> }>>,
    'listProjects',
  );
  let shared = false;
  for (const other of projects) {
    if (other.id === projectId || shared) continue;
    const sets = await listRows('imageSetsByProjectId', 'projectId', other.id, ['name']);
    shared = sets.some((set) => imageSetNames.has(set.name));
  }
  console.log(
    shared
      ? `Not deleting S3 data for project ${projectId} since it's shared with other projects`
      : `S3 data for project ${projectId} is not shared; S3 data deletion is not implemented yet`,
  );
}

// Children go before the rows that lead to them and the project row goes
// last, so a failed run can be repeated with the same projectId.
export const handler: DeleteProjectInFullHandler = async (event) => {
  const projectId = event.arguments.projectId;
  console.log(`Deleting project ${projectId}`);

  const project = (
    await client.graphql({ query: getProject, variables: { id: projectId } })
  ).data?.getProject;

  if (project) {
    authorizeRequest(event.identity, project.organizationId);
    // Router authorisation can be stale by the time an async invocation runs.
    const identity = event.identity as { sub?: string; groups?: string[] | null } | null;
    if (identity?.sub) await authorizeSurveyAdmin(identity, project, executeGraphql);
    await client.graphql({
      query: setProjectDeleting,
      variables: { input: { id: projectId, status: 'deleting' } },
    });
  } else {
    // The organisation is unknown once the row is gone.
    assertSysadmin(event.identity);
    console.warn(`Project ${projectId} row is gone; finishing its cleanup`);
  }

  const memberships = await listRows(
    'userProjectMembershipsByProjectId',
    'projectId',
    projectId,
    ['id', 'userId'],
  );
  const orgMembers = project
    ? await listRows(
        'membershipsByOrganizationId',
        'organizationId',
        project.organizationId,
        ['userId'],
      )
    : [];
  const userIds = [...memberships, ...orgMembers].map((m) => m.userId);

  // Memberships go first so project lists update right away.
  await mapLimit(memberships, async (membership) => {
    try {
      await client.graphql({
        query: deleteUserProjectMembership,
        variables: { input: { id: membership.id } },
      });
    } catch (error) {
      if (!isAlreadyGone(error)) throw error;
    }
  });

  const [annotationSets, locationSets, categories, imageSets, images, locations] =
    await Promise.all([
      listRows('annotationSetsByProjectId', 'projectId', projectId, ['id']),
      listRows('locationSetsByProjectId', 'projectId', projectId, ['id']),
      listRows('categoriesByProjectId', 'projectId', projectId, ['id']),
      listRows('imageSetsByProjectId', 'projectId', projectId, ['id', 'name']),
      listRows('imagesByProjectId', 'projectId', projectId, ['id']),
      listRows('locationsByProjectIdAndSource', 'projectId', projectId, [
        'id',
        'source',
      ]),
    ]);
  const annotationSetIds = annotationSets.map((set) => set.id);

  if (project) {
    try {
      await logS3Sharing(
        projectId,
        project.organizationId,
        new Set(imageSets.map((set) => set.name)),
      );
    } catch (error) {
      console.warn('S3 sharing check failed', error);
    }
  }

  failIfAny('children', [
    ...(await deleteIndexedSurveyRows(projectId, annotationSetIds, userIds)),
    ...(await runSteps([
      [
        'TasksOnAnnotationSet',
        async () => {
          for (const setId of annotationSetIds) {
            await sweep(
              spec('TasksOnAnnotationSet'),
              'locationSetsByAnnotationSetId',
              'annotationSetId',
              setId,
            );
          }
        },
      ],
      [
        'AnnotationInfoTag',
        async () => {
          for (const setId of annotationSetIds) {
            await sweepOwned(
              spec('AnnotationInfoTag', 'annotationId', 'infoTagId'),
              'annotationInfoTagsByAnnotationSetId',
              'annotationSetId',
              setId,
              projectId,
            );
          }
        },
      ],
      [
        'ImageFile',
        () =>
          mapLimit(images, (image) =>
            sweepOwned(
              spec('ImageFile'),
              'imagesByimageId',
              'imageId',
              image.id,
              projectId,
            ),
          ),
      ],
      [
        'Object',
        async () => {
          const objects = await fetchAllPages<ObjectRow, 'listObjects'>(
            (nextToken) =>
              client.graphql({
                query: listObjects,
                variables: { filter: { projectId: { eq: projectId } }, nextToken },
              }) as Promise<GraphQLResult<{ listObjects: PagedList<ObjectRow> }>>,
            'listObjects',
          );
          await deleteRows(spec('Object'), objects as unknown as Row[]);
        },
      ],
    ])),
    ...(await deleteLocationChildren(
      projectId,
      locations.map((location) => location.id),
      annotationSetIds,
      locations
        .filter((location) => location.source === 'testing')
        .map((location) => location.id),
    )),
  ]);

  failIfAny(
    'survey rows',
    await runSteps([
      [
        'InfoTag',
        async () => {
          await sweep(spec('InfoTag'), 'infoTagsByProjectId', 'projectId', projectId);
        },
      ],
      [
        'Annotation',
        async () => {
          await sweep(
            spec('Annotation'),
            'annotationsByProjectIdAndCreatedAt',
            'projectId',
            projectId,
          );
        },
      ],
      ['Location', () => deleteRows(spec('Location'), locations)],
      ['Image', () => deleteRows(spec('Image'), images)],
    ]),
  );

  failIfAny(
    'sets',
    await runSteps([
      ['Category', () => deleteRows(spec('Category'), categories)],
      ['LocationSet', () => deleteRows(spec('LocationSet'), locationSets)],
      ['AnnotationSet', () => deleteRows(spec('AnnotationSet'), annotationSets)],
    ]),
  );

  if (project) {
    await deleteRows(spec('Project'), [{ id: projectId }]);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Project deleted' }),
  };
};
