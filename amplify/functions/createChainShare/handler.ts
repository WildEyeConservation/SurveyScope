import { env } from '$amplify/env/createChainShare';
import { Amplify } from 'aws-amplify';
import { generateClient, GraphQLResult } from 'aws-amplify/data';
import type { CreateChainShareHandler } from '../../data/resource';
import { checkedGraph, shareLifecycle, mapWithConcurrency } from '../../chain-shares/lifecycle';

/**
 * Snapshot one annotation set's chain-viewer data into the read-only
 * SharedChain* tables, stamped with group `chainshare-<shareId>`. Mirrors the
 * IAM data-client pattern used by deleteProject.
 *
 * Scope (see src/chain-viewer/utils/herdPairs.ts): the herd view only builds
 * pairs among *annotated* images, and cross-camera crossovers require a direct
 * registered neighbour between annotated images. So we snapshot only annotated
 * images plus neighbours incident to them — bounded to the set's footprint, not
 * the whole project. (Chained transforms beyond 2 hops degrade to identity.)
 */

// --- Inline GraphQL (no codegen dependency on the new models) ---------------

const getAnnotationSet = /* GraphQL */ `
  query GetAnnotationSet($id: ID!) {
    getAnnotationSet(id: $id) { id name projectId }
  }
`;
const getProject = /* GraphQL */ `
  query GetProject($id: ID!) {
    getProject(id: $id) { id name organizationId }
  }
`;
const annotationsByAnnotationSetId = /* GraphQL */ `
  query AnnotationsBySet($setId: ID!, $nextToken: String) {
    annotationsByAnnotationSetId(setId: $setId, nextToken: $nextToken, limit: 1000) {
      items { id x y imageId objectId categoryId obscured oov }
      nextToken
    }
  }
`;
const categoriesByAnnotationSetId = /* GraphQL */ `
  query CategoriesBySet($annotationSetId: ID!, $nextToken: String) {
    categoriesByAnnotationSetId(annotationSetId: $annotationSetId, nextToken: $nextToken, limit: 1000) {
      items { id name color shortcutKey }
      nextToken
    }
  }
`;
const annotationInfoTagsByAnnotationSetId = /* GraphQL */ `
  query AnnotationInfoTagsBySet($annotationSetId: ID!, $nextToken: String) {
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
const infoTagsByAnnotationSetId = /* GraphQL */ `
  query InfoTagsBySet($annotationSetId: ID!, $nextToken: String) {
    infoTagsByAnnotationSetId(
      annotationSetId: $annotationSetId
      nextToken: $nextToken
      limit: 1000
    ) {
      items { id name }
      nextToken
    }
  }
`;
const camerasByProjectId = /* GraphQL */ `
  query CamerasByProject($projectId: ID!, $nextToken: String) {
    camerasByProjectId(projectId: $projectId, nextToken: $nextToken, limit: 1000) {
      items { id name }
      nextToken
    }
  }
`;
const getImage = /* GraphQL */ `
  query GetImage($id: ID!) {
    getImage(id: $id) {
      id width height originalPath timestamp cameraId cameraSerial
    }
  }
`;
const imageFilesByImageId = /* GraphQL */ `
  query ImageFilesByImageId($imageId: ID!, $nextToken: String) {
    imagesByimageId(imageId: $imageId, nextToken: $nextToken, limit: 1000) {
      items { key path type }
      nextToken
    }
  }
`;
const locationsByImageId = /* GraphQL */ `
  query LocationsByImageId($imageId: ID!, $nextToken: String) {
    locationsByImageKey(imageId: $imageId, nextToken: $nextToken, limit: 1000) {
      items { id imageId x y width height confidence source }
      nextToken
    }
  }
`;
const neighboursByImage1 = /* GraphQL */ `
  query NeighboursByImage1($image1Id: ID!, $nextToken: String) {
    imageNeighboursByImage1key(image1Id: $image1Id, nextToken: $nextToken, limit: 1000) {
      items { image1Id image2Id homography homographySource skipped }
      nextToken
    }
  }
`;
const neighboursByImage2 = /* GraphQL */ `
  query NeighboursByImage2($image2Id: ID!, $nextToken: String) {
    imageNeighboursByImage2key(image2Id: $image2Id, nextToken: $nextToken, limit: 1000) {
      items { image1Id image2Id homography homographySource skipped }
      nextToken
    }
  }
`;
const createSharedChainImage = /* GraphQL */ `
  mutation CreateSharedChainImage($input: CreateSharedChainImageInput!) {
    createSharedChainImage(input: $input) { id }
  }
`;
const createSharedChainAnnotation = /* GraphQL */ `
  mutation CreateSharedChainAnnotation($input: CreateSharedChainAnnotationInput!) {
    createSharedChainAnnotation(input: $input) { id }
  }
`;
const createSharedChainLocation = /* GraphQL */ `
  mutation CreateSharedChainLocation($input: CreateSharedChainLocationInput!) {
    createSharedChainLocation(input: $input) { id }
  }
`;
const createSharedChainNeighbour = /* GraphQL */ `
  mutation CreateSharedChainNeighbour($input: CreateSharedChainNeighbourInput!) {
    createSharedChainNeighbour(input: $input) { id }
  }
`;
const createSharedChainCategory = /* GraphQL */ `
  mutation CreateSharedChainCategory($input: CreateSharedChainCategoryInput!) {
    createSharedChainCategory(input: $input) { id }
  }
`;
// --- selectSourceKeyForImage (kept in sync with -------------------------------
// --- src/chain-viewer/utils/imageSourceKey.ts; src cannot be imported here) ---

interface ImageFileRow {
  key?: string | null;
  path?: string | null;
  type?: string | null;
}
function normalizeImagePath(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/\\/g, '/').replace(/^images\//, '');
}
function isJpegFile(file: ImageFileRow): boolean {
  const type = file.type?.toLowerCase() ?? '';
  const key = normalizeImagePath(file.key);
  const path = normalizeImagePath(file.path);
  return (
    type === 'image/jpeg' ||
    type === 'image/jpg' ||
    !!key?.match(/\.jpe?g$/i) ||
    !!path?.match(/\.jpe?g$/i)
  );
}
function imageFileMatchesOriginalPath(
  file: ImageFileRow,
  originalPath: string | null | undefined
): boolean {
  const original = normalizeImagePath(originalPath);
  if (!original) return false;
  const key = normalizeImagePath(file.key);
  const path = normalizeImagePath(file.path);
  return (
    key === original ||
    path === original ||
    !!key?.endsWith(`/${original}`) ||
    !!path?.endsWith(`/${original}`)
  );
}
function selectSourceKeyForImage(
  files: ImageFileRow[],
  originalPath: string | null | undefined
): string | null {
  const jpgs = files.filter(isJpegFile);
  const exact = jpgs.find((file) => imageFileMatchesOriginalPath(file, originalPath));
  return exact?.key ?? jpgs[0]?.key ?? null;
}

// --- Amplify client (IAM) ----------------------------------------------------

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
const graphql = checkedGraph((request) => client.graphql(request) as Promise<GraphQLResult<Record<string, unknown>>>);
const lifecycle = shareLifecycle(graphql);

const CHAIN_LOCATION_SOURCES = new Set([
  'scoutbotv3',
  'heatmap',
  'mad-v2',
  'stormfly-testing',
  'owl-d',
]);

interface PagedList<T> {
  items: T[];
  nextToken: string | null | undefined;
}

async function fetchAllPages<T, K extends string>(
  queryFn: (
    nextToken?: string
  ) => Promise<GraphQLResult<{ [key in K]: PagedList<T> }>>,
  queryName: K
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;
  do {
    const response = await queryFn(nextToken);
    const page = response.data?.[queryName];
    all.push(...((page?.items ?? []) as T[]));
    nextToken = page?.nextToken ?? undefined;
  } while (nextToken);
  return all;
}

// --- Row shapes we read ------------------------------------------------------

interface AnnotationRow {
  id: string;
  x: number;
  y: number;
  imageId: string;
  objectId?: string | null;
  categoryId: string;
  obscured?: boolean | null;
  oov?: boolean | null;
}
interface CategoryRow {
  id: string;
  name: string;
  color?: string | null;
  shortcutKey?: string | null;
}
interface AnnotationInfoTagRow {
  annotationId: string;
  infoTagId: string;
}
interface InfoTagRow {
  id: string;
  name: string;
}
interface ImageRow {
  id: string;
  width: number;
  height: number;
  originalPath?: string | null;
  timestamp?: number | null;
  cameraId?: string | null;
  cameraSerial?: string | null;
}
interface LocationRow {
  id: string;
  imageId: string;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  confidence?: number | null;
  source: string;
}
interface NeighbourRow {
  image1Id: string;
  image2Id: string;
  homography?: number[] | null;
  homographySource?: string | null;
  skipped?: boolean | null;
}

export const handler: CreateChainShareHandler = async (event) => {
  let started: string | undefined;
  const { annotationSetId, shareId } = event.arguments;
  try {
    if (!event.identity?.sub || !event.identity.groups?.includes('sysadmin')) {
      throw new Error('Unauthorized: sysadmin required');
    }
    const group = `chainshare-${shareId}`;

    // Resolve the set + project (no nested resolvers).
    const setResp = await graphql({
      query: getAnnotationSet,
      variables: { id: annotationSetId },
    });
    const annotationSet = (
      setResp as GraphQLResult<{
        getAnnotationSet: { id: string; name: string; projectId: string } | null;
      }>
    ).data?.getAnnotationSet;
    if (!annotationSet) throw new Error(`AnnotationSet ${annotationSetId} not found`);

    const projectResp = await graphql({
      query: getProject,
      variables: { id: annotationSet.projectId },
    });
    const project = (
      projectResp as GraphQLResult<{
        getProject: { id: string; name: string; organizationId: string } | null;
      }>
    ).data?.getProject;
    if (!project) throw new Error(`Project ${annotationSet.projectId} not found`);


    const createdBy =
      (event.identity && 'username' in event.identity
        ? (event.identity as { username?: string }).username
        : undefined) ?? '';

    started = await lifecycle.create({
      shareId, surveyId: project.id, annotationSetId,
      surveyName: project.name, annotationSetName: annotationSet.name, createdBy,
    });

    // --- Read source data ----------------------------------------------------
    const annotations = await fetchAllPages<AnnotationRow, 'annotationsByAnnotationSetId'>(
      (nextToken) =>
        graphql({
          query: annotationsByAnnotationSetId,
          variables: { setId: annotationSetId, nextToken },
        }) as Promise<GraphQLResult<{ annotationsByAnnotationSetId: PagedList<AnnotationRow> }>>,
      'annotationsByAnnotationSetId'
    );

    const categories = await fetchAllPages<CategoryRow, 'categoriesByAnnotationSetId'>(
      (nextToken) =>
        graphql({
          query: categoriesByAnnotationSetId,
          variables: { annotationSetId, nextToken },
        }) as Promise<GraphQLResult<{ categoriesByAnnotationSetId: PagedList<CategoryRow> }>>,
      'categoriesByAnnotationSetId'
    );

    const [annotationInfoTags, infoTags] = await Promise.all([
      fetchAllPages<
        AnnotationInfoTagRow,
        'annotationInfoTagsByAnnotationSetId'
      >(
        (nextToken) =>
          graphql({
            query: annotationInfoTagsByAnnotationSetId,
            variables: { annotationSetId, nextToken },
          }) as Promise<
            GraphQLResult<{
              annotationInfoTagsByAnnotationSetId: PagedList<AnnotationInfoTagRow>;
            }>
          >,
        'annotationInfoTagsByAnnotationSetId'
      ),
      fetchAllPages<InfoTagRow, 'infoTagsByAnnotationSetId'>(
        (nextToken) =>
          graphql({
            query: infoTagsByAnnotationSetId,
            variables: { annotationSetId, nextToken },
          }) as Promise<
            GraphQLResult<{
              infoTagsByAnnotationSetId: PagedList<InfoTagRow>;
            }>
          >,
        'infoTagsByAnnotationSetId'
      ),
    ]);
    const infoTagNameById = new Map(infoTags.map((tag) => [tag.id, tag.name]));
    const infoTagsByAnnotationId = new Map<string, string[]>();
    for (const row of annotationInfoTags) {
      const name = infoTagNameById.get(row.infoTagId);
      if (!name) continue;
      const names = infoTagsByAnnotationId.get(row.annotationId);
      if (names) names.push(name);
      else infoTagsByAnnotationId.set(row.annotationId, [name]);
    }
    for (const names of infoTagsByAnnotationId.values()) {
      names.sort((a, b) => a.localeCompare(b));
    }

    const cameras = await fetchAllPages<{ id: string; name: string }, 'camerasByProjectId'>(
      (nextToken) =>
        graphql({
          query: camerasByProjectId,
          variables: { projectId: project.id, nextToken },
        }) as Promise<GraphQLResult<{ camerasByProjectId: PagedList<{ id: string; name: string }> }>>,
      'camerasByProjectId'
    );
    const cameraNameById = new Map(cameras.map((c) => [c.id, c.name]));

    const annotatedImageIds = Array.from(new Set(annotations.map((a) => a.imageId)));

    // Per annotated image: full fields, source key, incident neighbours.
    const imagesById = new Map<string, ImageRow>();
    const sourceKeyById = new Map<string, string | null>();
    const neighbourByPair = new Map<string, NeighbourRow>();
    const locations: LocationRow[] = [];

    await mapWithConcurrency(annotatedImageIds, 20, async (imageId) => {
      const imgResp = await graphql({
        query: getImage,
        variables: { id: imageId },
      });
      const image = (
        imgResp as GraphQLResult<{ getImage: ImageRow | null }>
      ).data?.getImage;
      if (image) imagesById.set(imageId, image);

      const files = await fetchAllPages<ImageFileRow, 'imagesByimageId'>(
        (nextToken) =>
          graphql({
            query: imageFilesByImageId,
            variables: { imageId, nextToken },
          }) as Promise<GraphQLResult<{ imagesByimageId: PagedList<ImageFileRow> }>>,
        'imagesByimageId'
      );
      sourceKeyById.set(imageId, selectSourceKeyForImage(files, image?.originalPath));

      const imageLocations = await fetchAllPages<LocationRow, 'locationsByImageKey'>(
        (nextToken) =>
          graphql({
            query: locationsByImageId,
            variables: { imageId, nextToken },
          }) as Promise<GraphQLResult<{ locationsByImageKey: PagedList<LocationRow> }>>,
        'locationsByImageKey'
      );
      for (const loc of imageLocations) {
        if (CHAIN_LOCATION_SOURCES.has(loc.source)) locations.push(loc);
      }
      const incident = [
        ...(await fetchAllPages<NeighbourRow, 'imageNeighboursByImage1key'>(
          (nextToken) =>
            graphql({
              query: neighboursByImage1,
              variables: { image1Id: imageId, nextToken },
            }) as Promise<GraphQLResult<{ imageNeighboursByImage1key: PagedList<NeighbourRow> }>>,
          'imageNeighboursByImage1key'
        )),
        ...(await fetchAllPages<NeighbourRow, 'imageNeighboursByImage2key'>(
          (nextToken) =>
            graphql({
              query: neighboursByImage2,
              variables: { image2Id: imageId, nextToken },
            }) as Promise<GraphQLResult<{ imageNeighboursByImage2key: PagedList<NeighbourRow> }>>,
          'imageNeighboursByImage2key'
        )),
      ];
      for (const n of incident) {
        if (n.skipped) continue;
        neighbourByPair.set(`${n.image1Id}::${n.image2Id}`, n);
      }
    });

    // --- Write snapshot rows -------------------------------------------------
    await mapWithConcurrency(Array.from(imagesById.values()), 20, async (image) => {
      await graphql({
        query: createSharedChainImage,
        variables: {
          input: {
            shareId,
            sourceImageId: image.id,
            width: image.width,
            height: image.height,
            originalPath: image.originalPath ?? null,
            timestamp: image.timestamp ?? null,
            cameraId: image.cameraId ?? null,
            cameraName: image.cameraId ? cameraNameById.get(image.cameraId) ?? null : null,
            cameraSerial: image.cameraSerial ?? null,
            sourceKey: sourceKeyById.get(image.id) ?? null,
            group,
          },
        },
      });
    });

    await mapWithConcurrency(locations, 20, async (loc) => {
      await graphql({
        query: createSharedChainLocation,
        variables: {
          input: {
            shareId,
            sourceLocationId: loc.id,
            imageId: loc.imageId,
            x: loc.x,
            y: loc.y,
            width: loc.width ?? null,
            height: loc.height ?? null,
            confidence: loc.confidence ?? null,
            source: loc.source,
            group,
          },
        },
      });
    });

    await mapWithConcurrency(annotations, 20, async (a) => {
      const image = imagesById.get(a.imageId);
      await graphql({
        query: createSharedChainAnnotation,
        variables: {
          input: {
            shareId,
            sourceAnnotationId: a.id,
            x: a.x,
            y: a.y,
            imageId: a.imageId,
            objectId: a.objectId ?? null,
            categoryId: a.categoryId,
            obscured: a.obscured ?? false,
            oov: a.oov ?? false,
            imageTimestamp: image?.timestamp ?? null,
            infoTags: infoTagsByAnnotationId.get(a.id) ?? [],
            group,
          },
        },
      });
    });

    await mapWithConcurrency(Array.from(neighbourByPair.values()), 20, async (n) => {
      await graphql({
        query: createSharedChainNeighbour,
        variables: {
          input: {
            shareId,
            image1Id: n.image1Id,
            image2Id: n.image2Id,
            homography: n.homography ?? null,
            homographySource: n.homographySource ?? null,
            skipped: false,
            group,
          },
        },
      });
    });

    await mapWithConcurrency(categories, 20, async (c) => {
      await graphql({
        query: createSharedChainCategory,
        variables: {
          input: {
            shareId,
            sourceCategoryId: c.id,
            name: c.name,
            color: c.color ?? null,
            shortcutKey: c.shortcutKey ?? null,
            group,
          },
        },
      });
    });

    await lifecycle.activate(shareId, started);

    return {
      statusCode: 200,
      body: JSON.stringify({
        shareId,
        group,
        counts: {
          images: imagesById.size,
          annotations: annotations.length,
          neighbours: neighbourByPair.size,
          categories: categories.length,
          locations: locations.length,
        },
      }),
    };
  } catch (error) {
    console.error('createChainShare error:', error);
    if (started) {
      await lifecycle.failCreation(shareId, started, error).catch((failure) =>
        console.error('Could not record snapshot failure; recover after operation timeout', failure));
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error creating chain share',
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
