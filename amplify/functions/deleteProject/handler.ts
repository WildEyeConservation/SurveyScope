import { env } from '$amplify/env/deleteProject';
import { Amplify } from 'aws-amplify';
import type { DeleteProjectInFullHandler } from '../../data/resource';
import { authorizeRequest } from '../shared/authorizeRequest';
import {
  getProject,
  listImageSets,
  listProjects,
  listUserProjectMemberships,
  categoriesByProjectId,
  locationSetsByProjectId,
  annotationSetsByProjectId,
  imagesByProjectId,
  listObjects,
  locationSetsByAnnotationSetId,
  imageSetMembershipsByImageSetId,
  annotationsByAnnotationSetId,
  listLocations,
} from './graphql/queries';
import { generateClient, GraphQLResult } from 'aws-amplify/data';
import { DeleteQueueCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  Category,
  AnnotationSet,
  LocationSet,
  Project,
  UserProjectMembership,
  Image,
  Object as ObjectRow,
  TasksOnAnnotationSet,
  ImageSetMembership,
  Annotation,
  Location,
} from './graphql/API';

// Inline minimal mutations – return key fields + `group` to avoid nested-resolver
// auth failures while still enabling subscription delivery via groupDefinedIn('group').
const deleteProject = /* GraphQL */ `
  mutation DeleteProject($input: DeleteProjectInput!) {
    deleteProject(input: $input) { id group }
  }
`;

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
const deleteCategory = /* GraphQL */ `
  mutation DeleteCategory($input: DeleteCategoryInput!) {
    deleteCategory(input: $input) { id group }
  }
`;
const deleteImageSet = /* GraphQL */ `
  mutation DeleteImageSet($input: DeleteImageSetInput!) {
    deleteImageSet(input: $input) { id group }
  }
`;
const deleteLocationSet = /* GraphQL */ `
  mutation DeleteLocationSet($input: DeleteLocationSetInput!) {
    deleteLocationSet(input: $input) { id group }
  }
`;
const deleteAnnotationSet = /* GraphQL */ `
  mutation DeleteAnnotationSet($input: DeleteAnnotationSetInput!) {
    deleteAnnotationSet(input: $input) { id group }
  }
`;
const deleteImage = /* GraphQL */ `
  mutation DeleteImage($input: DeleteImageInput!) {
    deleteImage(input: $input) { id group }
  }
`;
const deleteObject = /* GraphQL */ `
  mutation DeleteObject($input: DeleteObjectInput!) {
    deleteObject(input: $input) { id group }
  }
`;
const deleteTasksOnAnnotationSet = /* GraphQL */ `
  mutation DeleteTasksOnAnnotationSet($input: DeleteTasksOnAnnotationSetInput!) {
    deleteTasksOnAnnotationSet(input: $input) { id group }
  }
`;
const deleteImageSetMembership = /* GraphQL */ `
  mutation DeleteImageSetMembership($input: DeleteImageSetMembershipInput!) {
    deleteImageSetMembership(input: $input) { id group }
  }
`;
const deleteAnnotation = /* GraphQL */ `
  mutation DeleteAnnotation($input: DeleteAnnotationInput!) {
    deleteAnnotation(input: $input) { id group }
  }
`;
const deleteLocation = /* GraphQL */ `
  mutation DeleteLocation($input: DeleteLocationInput!) {
    deleteLocation(input: $input) { id group }
  }
`;
const deleteInfoTag = /* GraphQL */ `
  mutation DeleteInfoTag($input: DeleteInfoTagInput!) {
    deleteInfoTag(input: $input) { id group }
  }
`;
const deleteAnnotationInfoTag = /* GraphQL */ `
  mutation DeleteAnnotationInfoTag($input: DeleteAnnotationInfoTagInput!) {
    deleteAnnotationInfoTag(input: $input) { annotationId infoTagId group }
  }
`;

// These models are newer than the checked-in generated queries.
const infoTagsByAnnotationSetId = /* GraphQL */ `
  query InfoTagsByAnnotationSetId($annotationSetId: ID!, $nextToken: String) {
    infoTagsByAnnotationSetId(
      annotationSetId: $annotationSetId
      nextToken: $nextToken
      limit: 1000
    ) {
      items { id }
      nextToken
    }
  }
`;
const annotationInfoTagsByAnnotationSetId = /* GraphQL */ `
  query AnnotationInfoTagsByAnnotationSetId(
    $annotationSetId: ID!
    $nextToken: String
  ) {
    annotationInfoTagsByAnnotationSetId(
      annotationSetId: $annotationSetId
      nextToken: $nextToken
      limit: 1000
    ) {
      items { annotationId infoTagId }
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

// Steps run independently: the project row is gone, so this cannot be retried.
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
          if (typeof queue.url !== 'string' || !queue.url) return;
          try {
            await sqs.send(new DeleteQueueCommand({ QueueUrl: queue.url }));
          } catch (error) {
            const name = (error as { name?: string }).name ?? '';
            if (!/NonExistentQueue|QueueDoesNotExist/.test(name)) throw error;
          }
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
          await sweep(
            spec('Observation'),
            'observationsByAnnotationSetId',
            'annotationSetId',
            setId,
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

export const handler: DeleteProjectInFullHandler = async (event) => {
  try {
    const projectId = event.arguments.projectId;

    console.log(`Deleting project ${projectId}`);

    const project = (
      await client.graphql({
        query: getProject,
        variables: {
          id: projectId,
        },
      })
    ).data?.getProject;

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    authorizeRequest(event.identity, project.organizationId);

    //delete project
    await client.graphql({
      query: deleteProject,
      variables: {
        input: {
          id: projectId,
        },
      },
    });

    // Delete user memberships immediately after the project record so other
    // clients' project lists update right away, instead of waiting for the
    // rest of the cascading cleanup (which can take minutes).
    const userMemberships = await fetchAllPages<
      UserProjectMembership,
      'listUserProjectMemberships'
    >(
      (nextToken) =>
        client.graphql({
          query: listUserProjectMemberships,
          variables: { filter: { projectId: { eq: projectId } }, nextToken },
        }) as Promise<
          GraphQLResult<{
            listUserProjectMemberships: PagedList<UserProjectMembership>;
          }>
        >,
      'listUserProjectMemberships'
    );

    await Promise.all(
      userMemberships.map(async (membership) => {
        await client.graphql({
          query: deleteUserProjectMembership,
          variables: { input: { id: membership.id } },
        });
      })
    );

    // get all projects for the same organization
    const allProjectsInOrganization = await fetchAllPages<
      Project,
      'listProjects'
    >(
      (nextToken) =>
        client.graphql({
          query: listProjects,
          variables: {
            filter: {
              organizationId: {
                eq: project.organizationId,
              },
            },
            nextToken,
          },
        }) as Promise<GraphQLResult<{ listProjects: PagedList<Project> }>>,
      'listProjects'
    );

    // get the image set for the project we want to delete
    const [imageSet] = (
      await client.graphql({
        query: listImageSets,
        variables: {
          filter: {
            projectId: { eq: projectId },
          },
        },
      })
    ).data?.listImageSets.items;

    // delete the image set for the project
    await client.graphql({
      query: deleteImageSet,
      variables: { input: { id: imageSet.id } },
    });

    // if there are other projects in the organization, check if they have an image set with the same name - this means they're sharing S3 data
    let deleteS3Data = true;
    if (allProjectsInOrganization.length !== 1) {
      for (const project of allProjectsInOrganization) {
        if (project.id === projectId) {
          continue;
        }

        const [otherImageSet] = (
          await client.graphql({
            query: listImageSets,
            variables: {
              filter: {
                projectId: { eq: project.id },
              },
            },
          })
        ).data?.listImageSets.items;

        // can't delete S3 data since another project references it
        if (otherImageSet?.name === imageSet?.name) {
          deleteS3Data = false;
          break;
        }
      }
    }

    if (deleteS3Data) {
      console.log(`Deleting S3 data for project ${projectId}`);
      console.warn('S3 data deletion is not implemented yet');
      //TODO: We can't wait for the delete to complete within a lambda - need to rethink how we handle this
    } else {
      console.log(
        `Not deleting S3 data for project ${projectId} since it's shared with other projects`
      );
    }

    // delete all categories for the project
    const categories = await fetchAllPages<Category, 'categoriesByProjectId'>(
      (nextToken) =>
        client.graphql({
          query: categoriesByProjectId,
          variables: { projectId: projectId, nextToken },
        }) as Promise<
          GraphQLResult<{ categoriesByProjectId: PagedList<Category> }>
        >,
      'categoriesByProjectId'
    );

    await Promise.all(
      categories.map(async (category) => {
        await client.graphql({
          query: deleteCategory,
          variables: { input: { id: category.id } },
        });
      })
    );

    // delete all location sets
    const locationSets = await fetchAllPages<
      LocationSet,
      'locationSetsByProjectId'
    >(
      (nextToken) =>
        client.graphql({
          query: locationSetsByProjectId,
          variables: { projectId: projectId, nextToken },
        }) as Promise<
          GraphQLResult<{ locationSetsByProjectId: PagedList<LocationSet> }>
        >,
      'locationSetsByProjectId'
    );

    await Promise.all(
      locationSets.map(async (locationSet) => {
        await client.graphql({
          query: deleteLocationSet,
          variables: { input: { id: locationSet.id } },
        });
      })
    );

    // delete all annotation sets
    const annotationSets = await fetchAllPages<
      AnnotationSet,
      'annotationSetsByProjectId'
    >(
      (nextToken) =>
        client.graphql({
          query: annotationSetsByProjectId,
          variables: { projectId: projectId, nextToken },
        }) as Promise<
          GraphQLResult<{ annotationSetsByProjectId: PagedList<AnnotationSet> }>
        >,
      'annotationSetsByProjectId'
    );

    await Promise.all(
      annotationSets.map(async (annotationSet) => {
        await client.graphql({
          query: deleteAnnotationSet,
          variables: { input: { id: annotationSet.id } },
        });
      })
    );

    const cleanupErrors = await deleteIndexedSurveyRows(
      projectId,
      annotationSets.map((annotationSet) => annotationSet.id),
      userMemberships.map((membership) => membership.userId)
    );

    // delete all images
    const images = await fetchAllPages<Image, 'imagesByProjectId'>(
      (nextToken) =>
        client.graphql({
          query: imagesByProjectId,
          variables: { projectId: projectId, nextToken },
        }) as Promise<GraphQLResult<{ imagesByProjectId: PagedList<Image> }>>,
      'imagesByProjectId'
    );

    await Promise.all(
      images.map(async (image) => {
        await client.graphql({
          query: deleteImage,
          variables: { input: { id: image.id } },
        });
      })
    );

    // delete all tasks on annotation sets
    for (const annotationSet of annotationSets) {
      const tasksOnAnnotationSet = await fetchAllPages<
        TasksOnAnnotationSet,
        'locationSetsByAnnotationSetId'
      >(
        (nextToken) =>
          client.graphql({
            query: locationSetsByAnnotationSetId,
            variables: { annotationSetId: annotationSet.id, nextToken },
          }) as Promise<
            GraphQLResult<{
              locationSetsByAnnotationSetId: PagedList<TasksOnAnnotationSet>;
            }>
          >,
        'locationSetsByAnnotationSetId'
      );

      await Promise.all(
        tasksOnAnnotationSet.map(async (task) => {
          await client.graphql({
            query: deleteTasksOnAnnotationSet,
            variables: { input: { id: task.id } },
          });
        })
      );
    }

    // delete image set memberships
    const imageSetMemberships = await fetchAllPages<
      ImageSetMembership,
      'imageSetMembershipsByImageSetId'
    >(
      (nextToken) =>
        client.graphql({
          query: imageSetMembershipsByImageSetId,
          variables: { imageSetId: imageSet.id, nextToken },
        }) as Promise<
          GraphQLResult<{
            imageSetMembershipsByImageSetId: PagedList<ImageSetMembership>;
          }>
        >,
      'imageSetMembershipsByImageSetId'
    );

    await Promise.all(
      imageSetMemberships.map(async (imageSetMembership) => {
        await client.graphql({
          query: deleteImageSetMembership,
          variables: { input: { id: imageSetMembership.id } },
        });
      })
    );

    // delete all image files
    await mapLimit(images, async (image) => {
      await sweep(spec('ImageFile'), 'imagesByimageId', 'imageId', image.id);
    });

    // delete all objects
    const objects = await fetchAllPages<ObjectRow, 'listObjects'>(
      (nextToken) =>
        client.graphql({
          query: listObjects,
          variables: { filter: { projectId: { eq: projectId } }, nextToken },
        }) as Promise<GraphQLResult<{ listObjects: PagedList<ObjectRow> }>>,
      'listObjects'
    );

    await Promise.all(
      objects.map(async (object) => {
        await client.graphql({
          query: deleteObject,
          variables: { input: { id: object.id } },
        });
      })
    );

    for (const annotationSet of annotationSets) {
      const infoTagLinks = await fetchAllPages<
        { annotationId: string; infoTagId: string },
        'annotationInfoTagsByAnnotationSetId'
      >(
        (nextToken) =>
          client.graphql({
            query: annotationInfoTagsByAnnotationSetId,
            variables: { annotationSetId: annotationSet.id, nextToken },
          }) as Promise<
            GraphQLResult<{
              annotationInfoTagsByAnnotationSetId: PagedList<{
                annotationId: string;
                infoTagId: string;
              }>;
            }>
          >,
        'annotationInfoTagsByAnnotationSetId'
      );

      await Promise.all(
        infoTagLinks.map(async (link) => {
          await client.graphql({
            query: deleteAnnotationInfoTag,
            variables: {
              input: {
                annotationId: link.annotationId,
                infoTagId: link.infoTagId,
              },
            },
          });
        })
      );

      const infoTags = await fetchAllPages<
        { id: string },
        'infoTagsByAnnotationSetId'
      >(
        (nextToken) =>
          client.graphql({
            query: infoTagsByAnnotationSetId,
            variables: { annotationSetId: annotationSet.id, nextToken },
          }) as Promise<
            GraphQLResult<{
              infoTagsByAnnotationSetId: PagedList<{ id: string }>;
            }>
          >,
        'infoTagsByAnnotationSetId'
      );

      await Promise.all(
        infoTags.map(async (infoTag) => {
          await client.graphql({
            query: deleteInfoTag,
            variables: { input: { id: infoTag.id } },
          });
        })
      );
    }

    // delete all annotations
    for (const annotationSet of annotationSets) {
      const annotations = await fetchAllPages<
        Annotation,
        'annotationsByAnnotationSetId'
      >(
        (nextToken) =>
          client.graphql({
            query: annotationsByAnnotationSetId,
            variables: { setId: annotationSet.id, nextToken },
          }) as Promise<
            GraphQLResult<{
              annotationsByAnnotationSetId: PagedList<Annotation>;
            }>
          >,
        'annotationsByAnnotationSetId'
      );

      await Promise.all(
        annotations.map(async (annotation) => {
          await client.graphql({
            query: deleteAnnotation,
            variables: { input: { id: annotation.id } },
          });
        })
      );
    }

    // delete all locations
    const locations = await fetchAllPages<Location, 'listLocations'>(
      (nextToken) =>
        client.graphql({
          query: listLocations,
          variables: { filter: { projectId: { eq: projectId } }, nextToken },
        }) as Promise<GraphQLResult<{ listLocations: PagedList<Location> }>>,
      'listLocations'
    );

    await Promise.all(
      locations.map(async (location) => {
        await client.graphql({
          query: deleteLocation,
          variables: { input: { id: location.id } },
        });
      })
    );

    cleanupErrors.push(
      ...(await deleteLocationChildren(
        projectId,
        locations.map((location) => location.id),
        annotationSets.map((annotationSet) => annotationSet.id),
        locations
          .filter((location) => location.source === 'testing')
          .map((location) => location.id)
      ))
    );

    if (cleanupErrors.length) {
      throw new Error(`Incomplete cleanup: ${cleanupErrors.join(' | ')}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Project deleted',
      }),
    };
  } catch (error: any) {
    console.error('Error details:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error deleting project',
        error: error.message,
      }),
    };
  }
};
