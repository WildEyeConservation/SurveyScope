import type { Handler } from 'aws-lambda';
import { env } from '$amplify/env/reconcileHomographies';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { GraphQLResult } from '@aws-amplify/api-graphql';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import pLimit from 'p-limit';
import { isUnder, QUEUE_MANIFEST_PREFIX } from '../shared/s3Keys';

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

const s3Client = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
  },
});

type ImageMeta = {
  id: string;
  projectId?: string;
  timestamp: number | null;
  width: number;
  height: number;
  originalPath: string | null;
};

type AnnotationRecord = {
  id: string;
  imageId: string;
  x: number;
  y: number;
  objectId: string | null;
};

// Homography maps FROM the owning image TO the neighbour.
type NeighbourEdge = {
  neighbourId: string;
  homography: number[];
};

type ManifestItem = {
  pairKey: string;
  image1Id: string;
  image2Id: string;
};

const getImageWithNeighboursQuery = /* GraphQL */ `
  query GetImage($id: ID!) {
    getImage(id: $id) {
      id
      projectId
      timestamp
      width
      height
      originalPath
      leftNeighbours(limit: 100) {
        items {
          image2Id
          homography
          skipped
        }
      }
      rightNeighbours(limit: 100) {
        items {
          image1Id
          homography
          skipped
        }
      }
    }
  }
`;

const getImageMetaQuery = /* GraphQL */ `
  query GetImageMeta($id: ID!) {
    getImage(id: $id) {
      id
      timestamp
      width
      height
      originalPath
    }
  }
`;

const getAnnotationSetQuery = /* GraphQL */ `
  query GetAnnotationSet($id: ID!) {
    getAnnotationSet(id: $id) {
      id
      projectId
    }
  }
`;

const getQueueQuery = /* GraphQL */ `
  query GetQueue($id: ID!) {
    getQueue(id: $id) {
      id
      projectId
      annotationSetId
    }
  }
`;

const annotationsByImageIdAndSetIdQuery = /* GraphQL */ `
  query AnnotationsByImageIdAndSetId(
    $imageId: ID!
    $setId: ModelIDKeyConditionInput
    $limit: Int
    $nextToken: String
  ) {
    annotationsByImageIdAndSetId(
      imageId: $imageId
      setId: $setId
      limit: $limit
      nextToken: $nextToken
    ) {
      items {
        id
        imageId
        x
        y
        objectId
      }
      nextToken
    }
  }
`;

const updateAnnotationMutation = /* GraphQL */ `
  mutation UpdateAnnotation($input: UpdateAnnotationInput!) {
    updateAnnotation(input: $input) {
      id
    }
  }
`;

function applyHomography(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

function invertHomography(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) throw new Error('Degenerate homography matrix');
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ];
}

async function downloadManifest(manifestS3Key: string): Promise<ManifestItem[]> {
  const bucketName = (env as any).OUTPUTS_BUCKET_NAME;
  if (!bucketName) throw new Error('OUTPUTS_BUCKET_NAME not set');

  const res = await s3Client.send(
    new GetObjectCommand({ Bucket: bucketName, Key: manifestS3Key })
  );
  const body = await res.Body?.transformToString();
  if (!body) throw new Error('Empty manifest from S3');

  const manifest: { items: ManifestItem[] } = JSON.parse(body);
  return manifest.items;
}

async function deleteManifest(manifestS3Key: string): Promise<void> {
  const bucketName = (env as any).OUTPUTS_BUCKET_NAME;
  if (!bucketName) return;
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucketName, Key: manifestS3Key })
    );
    console.log('Deleted S3 manifest', { key: manifestS3Key });
  } catch (err) {
    console.warn('Failed to delete S3 manifest:', err);
  }
}

type ImageWithNeighbours = {
  id: string;
  projectId?: string | null;
  timestamp: string | number | null;
  width: number;
  height: number;
  originalPath: string | null;
  leftNeighbours?: {
    items?: Array<{
      image2Id: string;
      homography: number[] | null;
      skipped: boolean | null;
    }>;
  };
  rightNeighbours?: {
    items?: Array<{
      image1Id: string;
      homography: number[] | null;
      skipped: boolean | null;
    }>;
  };
};

async function fetchAffectedImagesAndGraph(
  affectedImageIds: Set<string>
): Promise<{
  images: Map<string, ImageMeta>;
  graph: Map<string, NeighbourEdge[]>;
  missingNeighbourIds: Set<string>;
}> {
  const images = new Map<string, ImageMeta>();
  const graph = new Map<string, NeighbourEdge[]>();
  const missingNeighbourIds = new Set<string>();

  const limit = pLimit(15);
  const ids = Array.from(affectedImageIds);

  await Promise.all(
    ids.map((imageId) =>
      limit(async () => {
        const res = (await client.graphql({
          query: getImageWithNeighboursQuery,
          variables: { id: imageId },
        } as any)) as GraphQLResult<{ getImage?: ImageWithNeighbours | null }>;

        if (res.errors?.length) {
          console.warn(`Failed to fetch image ${imageId}:`, res.errors);
          return;
        }
        const item = res.data?.getImage;
        if (!item) return;

        images.set(item.id, {
          id: item.id,
          projectId: item.projectId ?? undefined,
          timestamp: item.timestamp ? new Date(item.timestamp as string).getTime() : null,
          width: item.width,
          height: item.height,
          originalPath: item.originalPath ?? null,
        });

        const edges: NeighbourEdge[] = [];

        // leftNeighbours store H as other→this, so invert for this→other.
        for (const nb of item.leftNeighbours?.items ?? []) {
          if (nb.skipped || !nb.homography || nb.homography.length !== 9) continue;
          edges.push({ neighbourId: nb.image2Id, homography: invertHomography(nb.homography) });
          if (!affectedImageIds.has(nb.image2Id)) missingNeighbourIds.add(nb.image2Id);
        }

        // rightNeighbours store H as this→other already.
        for (const nb of item.rightNeighbours?.items ?? []) {
          if (nb.skipped || !nb.homography || nb.homography.length !== 9) continue;
          edges.push({ neighbourId: nb.image1Id, homography: nb.homography });
          if (!affectedImageIds.has(nb.image1Id)) missingNeighbourIds.add(nb.image1Id);
        }

        graph.set(item.id, edges);
      })
    )
  );

  return { images, graph, missingNeighbourIds };
}

async function fetchNeighbourMetadata(
  neighbourIds: Set<string>,
  images: Map<string, ImageMeta>
): Promise<void> {
  const limit = pLimit(15);
  const ids = Array.from(neighbourIds).filter((id) => !images.has(id));

  await Promise.all(
    ids.map((imageId) =>
      limit(async () => {
        const res = (await client.graphql({
          query: getImageMetaQuery,
          variables: { id: imageId },
        } as any)) as GraphQLResult<{
          getImage?: {
            id: string;
            timestamp: string | number | null;
            width: number;
            height: number;
            originalPath: string | null;
          } | null;
        }>;

        if (res.errors?.length) {
          console.warn(`Failed to fetch neighbour image ${imageId}:`, res.errors);
          return;
        }
        const item = res.data?.getImage;
        if (!item) return;

        images.set(item.id, {
          id: item.id,
          timestamp: item.timestamp ? new Date(item.timestamp as string).getTime() : null,
          width: item.width,
          height: item.height,
          originalPath: item.originalPath ?? null,
        });
      })
    )
  );
}

async function fetchAnnotationsForImages(
  setId: string,
  imageIds: Set<string>
): Promise<AnnotationRecord[]> {
  const annotations: AnnotationRecord[] = [];
  const limit = pLimit(15);

  await Promise.all(
    Array.from(imageIds).map((imageId) =>
      limit(async () => {
        let nextToken: string | undefined;
        do {
          const res = (await client.graphql({
            query: annotationsByImageIdAndSetIdQuery,
            variables: {
              imageId,
              setId: { eq: setId },
              limit: 10000,
              nextToken,
            },
          } as any)) as GraphQLResult<{
            annotationsByImageIdAndSetId?: {
              items?: Array<{
                id: string;
                imageId: string;
                x: number;
                y: number;
                objectId: string | null;
              }>;
              nextToken?: string | null;
            };
          }>;

          if (res.errors?.length) {
            console.warn(`Failed to fetch annotations for image ${imageId}:`, res.errors);
            break;
          }

          for (const item of res.data?.annotationsByImageIdAndSetId?.items ?? []) {
            annotations.push({
              id: item.id,
              imageId: item.imageId,
              x: item.x,
              y: item.y,
              objectId: item.objectId ?? null,
            });
          }
          nextToken = res.data?.annotationsByImageIdAndSetId?.nextToken ?? undefined;
        } while (nextToken);
      })
    )
  );

  return annotations;
}

function isOlder(a: ImageMeta, b: ImageMeta): boolean {
  if (a.timestamp !== null && b.timestamp !== null) {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp;
  } else if (a.timestamp === null || b.timestamp === null) {
    return false;
  }
  if (a.originalPath && b.originalPath) return a.originalPath < b.originalPath;
  return false;
}

function deduplicate(
  annotations: AnnotationRecord[],
  images: Map<string, ImageMeta>,
  graph: Map<string, NeighbourEdge[]>
): Array<{ id: string; objectId: string | null }> {
  const updates: Array<{ id: string; objectId: string | null }> = [];

  for (const ann of annotations) {
    const currentImg = images.get(ann.imageId);
    if (!currentImg) continue;

    const neighbours = graph.get(ann.imageId) ?? [];

    let seenEarlier = false;
    for (const edge of neighbours) {
      const neighbourImg = images.get(edge.neighbourId);
      if (!neighbourImg) continue;
      if (!isOlder(neighbourImg, currentImg)) continue;

      const [px, py] = applyHomography(edge.homography, ann.x, ann.y);

      if (px >= 0 && px < neighbourImg.width && py >= 0 && py < neighbourImg.height) {
        seenEarlier = true;
        break;
      }
    }

    const correctObjectId = seenEarlier ? null : ann.id;

    if (ann.objectId !== correctObjectId) {
      updates.push({ id: ann.id, objectId: correctObjectId });
    }
  }

  return updates;
}

async function batchUpdate(
  updates: Array<{ id: string; objectId: string | null }>
): Promise<void> {
  const limit = pLimit(100);
  let completed = 0;

  const tasks = updates.map((update) =>
    limit(async () => {
      try {
        await client.graphql({
          query: updateAnnotationMutation,
          variables: { input: update },
        } as any);
        completed++;
        if (completed % 1000 === 0) {
          console.log(`Updated ${completed}/${updates.length} annotations`);
        }
      } catch (err) {
        console.warn('Failed to update annotation', { id: update.id, error: err });
      }
    })
  );

  await Promise.all(tasks);
  console.log(`Completed ${completed}/${updates.length} annotation updates`);
}

// Resolves the set's project and checks the payload's queue and project claims against it.
async function resolveProjectId(
  annotationSetId: string,
  queueId: string | undefined,
  claimedProjectId: string | undefined
): Promise<string | null> {
  const setRes = (await client.graphql({
    query: getAnnotationSetQuery,
    variables: { id: annotationSetId },
  })) as GraphQLResult<{ getAnnotationSet?: { projectId: string } | null }>;
  const projectId = setRes.data?.getAnnotationSet?.projectId;
  if (!projectId) {
    console.error('AnnotationSet not found', { annotationSetId });
    return null;
  }
  if (claimedProjectId && claimedProjectId !== projectId) {
    console.error('Payload projectId does not match annotation set project', {
      annotationSetId,
      projectId,
      claimedProjectId,
    });
    return null;
  }
  if (queueId) {
    const queueRes = (await client.graphql({
      query: getQueueQuery,
      variables: { id: queueId },
    })) as GraphQLResult<{
      getQueue?: { projectId: string; annotationSetId: string | null } | null;
    }>;
    const queue = queueRes.data?.getQueue;
    // The queue may already be deleted by the caller; then only the project claim applies.
    if (queue && (queue.annotationSetId !== annotationSetId || queue.projectId !== projectId)) {
      console.error('Queue does not match annotation set', {
        queueId,
        annotationSetId,
        projectId,
        queueProjectId: queue.projectId,
        queueAnnotationSetId: queue.annotationSetId,
      });
      return null;
    }
  }
  return projectId;
}

export const handler: Handler = async (event) => {
  try {
    const payload = typeof event === 'string' ? JSON.parse(event) : event;
    const { annotationSetId, manifestS3Key, queueId, projectId: claimedProjectId } = payload;

    if (!annotationSetId) {
      console.error('Missing annotationSetId in event');
      return { statusCode: 400, body: 'Missing annotationSetId' };
    }

    if (!manifestS3Key) {
      console.error('Missing manifestS3Key in event — cannot do targeted reconciliation');
      return { statusCode: 400, body: 'Missing manifestS3Key' };
    }

    if (!isUnder(manifestS3Key, QUEUE_MANIFEST_PREFIX)) {
      console.error('Rejected manifestS3Key outside queue manifests', { manifestS3Key });
      return { statusCode: 400, body: 'Invalid manifestS3Key' };
    }

    console.log('reconcileHomographies invoked', { annotationSetId, manifestS3Key });

    const projectId = await resolveProjectId(annotationSetId, queueId, claimedProjectId);
    if (!projectId) {
      return { statusCode: 400, body: 'Annotation set, queue and project do not match' };
    }

    const manifestItems = await downloadManifest(manifestS3Key);
    const affectedImageIds = new Set<string>();
    for (const item of manifestItems) {
      affectedImageIds.add(item.image1Id);
      affectedImageIds.add(item.image2Id);
    }
    console.log('Manifest loaded', {
      pairs: manifestItems.length,
      affectedImages: affectedImageIds.size,
    });

    if (affectedImageIds.size === 0) {
      console.log('No affected images — nothing to reconcile');
      await deleteManifest(manifestS3Key);
      return { statusCode: 200, body: JSON.stringify({ updated: 0 }) };
    }

    const { images, graph, missingNeighbourIds } =
      await fetchAffectedImagesAndGraph(affectedImageIds);
    for (const imageId of affectedImageIds) {
      const image = images.get(imageId);
      if (image && image.projectId !== projectId) {
        console.error('Manifest image belongs to another project', {
          imageId,
          imageProjectId: image.projectId,
          projectId,
          manifestS3Key,
        });
        return { statusCode: 400, body: 'Manifest image outside project' };
      }
    }
    console.log('Fetched affected images', {
      fetched: images.size,
      neighboursToFetch: missingNeighbourIds.size,
    });

    if (missingNeighbourIds.size > 0) {
      await fetchNeighbourMetadata(missingNeighbourIds, images);
      console.log('Fetched neighbour metadata', { total: images.size });
    }

    const annotations = await fetchAnnotationsForImages(annotationSetId, affectedImageIds);
    console.log('Fetched annotations for affected images', { count: annotations.length });

    if (annotations.length === 0) {
      console.log('No annotations to reconcile');
      await deleteManifest(manifestS3Key);
      return { statusCode: 200, body: JSON.stringify({ updated: 0 }) };
    }

    const updates = deduplicate(annotations, images, graph);
    console.log('Deduplication complete', {
      total: annotations.length,
      changed: updates.length,
      nowSecondary: updates.filter((u) => u.objectId === null).length,
      nowPrimary: updates.filter((u) => u.objectId !== null).length,
    });

    if (updates.length > 0) {
      await batchUpdate(updates);
    }

    await deleteManifest(manifestS3Key);

    return {
      statusCode: 200,
      body: JSON.stringify({
        affectedImages: affectedImageIds.size,
        annotationsChecked: annotations.length,
        updated: updates.length,
      }),
    };
  } catch (error: any) {
    console.error('reconcileHomographies failed', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Reconciliation failed',
        error: error?.message ?? 'Unknown error',
      }),
    };
  }
};
