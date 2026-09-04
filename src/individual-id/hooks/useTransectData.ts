import { useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProjectContext } from '../../Context';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';
import type {
  AnnotationType,
  CategoryType,
  ImageNeighbourType,
  ImageType,
} from '../../schemaTypes';
import { attachInfoTagsToAnnotations } from '../../infoTags';

// Amplify's return type doesn't reflect custom selectionSets, so we type this explicitly.
type ImageWithNeighbours = Pick<
  ImageType,
  'id' | 'width' | 'height' | 'originalPath' | 'timestamp' | 'cameraId'
> & {
  leftNeighbours?: ImageNeighbourType[] | null;
  rightNeighbours?: ImageNeighbourType[] | null;
};

// Neighbours have no phase — they're embedded in the images query via selectionSet.
export interface LoadProgress {
  phase: 'idle' | 'category' | 'images' | 'cameras' | 'annotations' | 'done';
  images: number;
  annotations: number;
}

interface UseTransectDataInput {
  transectId: string | undefined;
  categoryId: string | undefined;
  annotationSetId: string | undefined;
  /**
   * If set, the hook switches into "chain review" mode: instead of loading a
   * transect, it loads the chain whose primary annotation has this id plus
   * every neighbour of every image that chain touches. Same `TransectData`
   * shape comes back so the harness doesn't care which path produced it.
   * Mutually exclusive with `transectId` — pass exactly one.
   */
  chainObjectId?: string;
}

// Plain JSON only — React Query persists this to localStorage; non-serializable values are silently dropped.
export interface TransectData {
  category: CategoryType | null;
  images: ImageType[];
  imagesById: Record<string, ImageType>;
  annotations: AnnotationType[];
  annotationsByImage: Record<string, AnnotationType[]>;
  rawNeighbours: ImageNeighbourType[];
  cameraNamesById: Record<string, string>;
}

export function useTransectData(input: UseTransectDataInput) {
  const { project } = useContext(ProjectContext)!;
  const { transectId, categoryId, annotationSetId, chainObjectId } = input;

  const isChainMode = Boolean(chainObjectId);
  const enabled = Boolean(
    categoryId && project?.id && (transectId || chainObjectId)
  );

  const [progress, setProgress] = useState<LoadProgress>({
    phase: 'idle',
    images: 0,
    annotations: 0,
  });

  const queryKey = useMemo(
    () =>
      isChainMode
        ? [
            'individual-id-chain',
            project?.id,
            chainObjectId,
            categoryId,
            annotationSetId,
          ]
        : [
            'individual-id-transect',
            project?.id,
            transectId,
            categoryId,
            annotationSetId,
          ],
    [
      isChainMode,
      project?.id,
      transectId,
      chainObjectId,
      categoryId,
      annotationSetId,
    ]
  );

  const query = useQuery<TransectData>({
    queryKey,
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      if (isChainMode) {
        return fetchChainData({
          client,
          projectId: project!.id,
          primaryId: chainObjectId!,
          categoryId: categoryId!,
          annotationSetId,
          setProgress,
        });
      }
      setProgress({ phase: 'category', images: 0, annotations: 0 });
      const categoryResp = await client.models.Category.get({ id: categoryId! });
      const category = (categoryResp?.data ?? null) as CategoryType | null;
      const setId = annotationSetId ?? category?.annotationSetId ?? '';
      if (!setId) {
        throw new Error(
          `Cannot resolve annotationSetId for category ${categoryId}`
        );
      }

      setProgress((p) => ({ ...p, phase: 'images' }));
      const images = (await fetchAllPaginatedResults<ImageType>(
        client.models.Image.imagesByProjectIdAndTransectId,
        {
          projectId: project!.id,
          transectId: { eq: transectId },
          limit: 10000,
          selectionSet: [
            'id',
            'width',
            'height',
            'originalPath',
            'timestamp',
            'cameraId',
            'leftNeighbours.*',
            'rightNeighbours.*',
          ],
        },
        (n) => setProgress((p) => ({ ...p, images: n }))
      )) as unknown as ImageWithNeighbours[];

      const imagesById: Record<string, ImageType> = {};
      for (const img of images) {
        imagesById[img.id] = img as unknown as ImageType;
      }

      setProgress((p) => ({ ...p, phase: 'cameras' }));
      const cameraResp = await client.models.Camera.camerasByProjectId(
        { projectId: project!.id },
        { selectionSet: ['id', 'name'], limit: 1000 }
      );
      const cameraNamesById: Record<string, string> = {};
      for (const c of (cameraResp.data ?? []) as Array<{
        id?: string | null;
        name?: string | null;
      }>) {
        if (c?.id && c?.name) cameraNamesById[c.id] = c.name;
      }

      const imageIds = new Set(images.map((i) => i.id));
      const seen = new Set<string>();
      const rawNeighbours: ImageNeighbourType[] = [];
      for (const img of images) {
        for (const n of [
          ...(img.leftNeighbours ?? []),
          ...(img.rightNeighbours ?? []),
        ]) {
          if (n.skipped) continue;
          if (!imageIds.has(n.image1Id) || !imageIds.has(n.image2Id)) continue;
          const k = `${n.image1Id}__${n.image2Id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          rawNeighbours.push(n);
        }
      }

      setProgress((p) => ({ ...p, phase: 'annotations' }));
      // Load every category in the set, then every annotation in each. The
      // workflow filters to `categoryId`, but the maps also render the other
      // categories as read-only informational markers so the user can see
      // which animals have already been marked.
      const categoriesResp =
        await client.models.Category.categoriesByAnnotationSetId(
          { annotationSetId: setId },
          { selectionSet: ['id'], limit: 1000 }
        );
      const categoryIds = (
        (categoriesResp.data ?? []) as Array<{ id?: string | null }>
      )
        .map((c) => c?.id)
        .filter((id): id is string => !!id);
      if (categoryId && !categoryIds.includes(categoryId)) {
        categoryIds.push(categoryId);
      }

      const perCategoryCounts = new Array(categoryIds.length).fill(0);
      const perCategory = await Promise.all(
        categoryIds.map((cid, idx) =>
          fetchAllPaginatedResults<AnnotationType>(
            client.models.Annotation.annotationsByCategoryId,
            {
              categoryId: cid,
              filter: { setId: { eq: setId } },
              limit: 10000,
            },
            (n) => {
              perCategoryCounts[idx] = n;
              setProgress((p) => ({
                ...p,
                annotations: perCategoryCounts.reduce((s, c) => s + c, 0),
              }));
            }
          )
        )
      );
      const filteredAnnotations = perCategory
        .flat()
        .filter((a) => imageIds.has(a.imageId));
      const annotations = await attachInfoTagsToAnnotations(
        client,
        filteredAnnotations,
        setId
      );

      const annotationsByImage: Record<string, AnnotationType[]> = {};
      for (const a of annotations) {
        (annotationsByImage[a.imageId] ??= []).push(a);
      }

      setProgress((p) => ({ ...p, phase: 'done' }));
      return {
        category,
        images: images as unknown as ImageType[],
        imagesById,
        annotations,
        annotationsByImage,
        rawNeighbours,
        cameraNamesById,
      };
    },
  });

  return useMemo(() => ({ ...query, progress }), [query, progress]);
}

/**
 * Chain-review fetch path. Resolves the chain (annotations sharing
 * `primaryId` as objectId in the set), expands to the broad neighbourhood
 * (every neighbour of every chain image so the user can discover unlinked
 * sightings), and produces the same `TransectData` shape the harness
 * consumes from the transect path.
 *
 * Notes vs. the transect path:
 *   - Images are fetched per-id, since there's no chain-wide index. With
 *     a few dozen images per chain that's tolerable.
 *   - Annotations are fetched per-image (`annotationsByImageIdAndSetId`)
 *     rather than per-category — much smaller than scanning the whole set
 *     when the neighbourhood is narrow.
 *   - `category` is loaded the same way; downstream code uses it for the
 *     workflow's "active category", which still corresponds to the chain's
 *     category.
 */
async function fetchChainData(opts: {
  client: any;
  projectId: string;
  primaryId: string;
  categoryId: string;
  annotationSetId: string | undefined;
  setProgress: (next: LoadProgress | ((p: LoadProgress) => LoadProgress)) => void;
}): Promise<TransectData> {
  const {
    client,
    projectId,
    primaryId,
    categoryId,
    annotationSetId,
    setProgress,
  } = opts;

  setProgress({ phase: 'category', images: 0, annotations: 0 });
  const categoryResp = await client.models.Category.get({ id: categoryId });
  const category = (categoryResp?.data ?? null) as CategoryType | null;
  const setId = annotationSetId ?? category?.annotationSetId ?? '';
  if (!setId) {
    throw new Error(
      `Cannot resolve annotationSetId for category ${categoryId}`
    );
  }

  // 1. Chain annotations — every annotation whose objectId == primaryId.
  //    For primaries with no other linked annotations the primary itself
  //    still has objectId === id, so this covers singletons too.
  const chainAnnotations = (await fetchAllPaginatedResults<AnnotationType>(
    client.models.Annotation.annotationsByObjectId,
    {
      objectId: primaryId,
      filter: { setId: { eq: setId } },
      limit: 1000,
    }
  )) as AnnotationType[];

  const chainImageIds = new Set<string>(chainAnnotations.map((a) => a.imageId));
  if (chainImageIds.size === 0) {
    throw new Error(`Chain ${primaryId} has no annotations in set ${setId}`);
  }

  // 2. Fetch each chain image with its neighbour edges. Parallel — chains
  //    are typically small (<50 images).
  setProgress((p) => ({ ...p, phase: 'images' }));
  const chainImageResps = await Promise.all(
    Array.from(chainImageIds).map((imageId) =>
      (client.models.Image.get as any)(
        { id: imageId },
        {
          selectionSet: [
            'id',
            'width',
            'height',
            'originalPath',
            'timestamp',
            'cameraId',
            'leftNeighbours.*',
            'rightNeighbours.*',
          ],
        }
      )
    )
  );
  const chainImages = chainImageResps
    .map((r) => r?.data as ImageWithNeighbours | null)
    .filter((img): img is ImageWithNeighbours => !!img);

  // 3. Collect all neighbour image ids (the broad neighbourhood). Skipped
  //    edges are ignored — they'd never produce a reviewable pair anyway.
  const neighbourImageIds = new Set<string>();
  for (const img of chainImages) {
    for (const n of [
      ...(img.leftNeighbours ?? []),
      ...(img.rightNeighbours ?? []),
    ]) {
      if (n.skipped) continue;
      neighbourImageIds.add(n.image1Id);
      neighbourImageIds.add(n.image2Id);
    }
  }
  const additionalIds = Array.from(neighbourImageIds).filter(
    (id) => !chainImageIds.has(id)
  );
  setProgress((p) => ({ ...p, images: chainImages.length }));

  // 4. Fetch the additional images. No nested neighbours needed — the
  //    edges have already been harvested from the chain images.
  const additionalImageResps = await Promise.all(
    additionalIds.map((imageId) =>
      (client.models.Image.get as any)(
        { id: imageId },
        {
          selectionSet: [
            'id',
            'width',
            'height',
            'originalPath',
            'timestamp',
            'cameraId',
          ],
        }
      )
    )
  );
  const additionalImages = additionalImageResps
    .map((r) => r?.data as ImageType | null)
    .filter((img): img is ImageType => !!img);

  const images: ImageType[] = [
    ...(chainImages as unknown as ImageType[]),
    ...additionalImages,
  ];
  const imagesById: Record<string, ImageType> = {};
  for (const img of images) imagesById[img.id] = img;
  const allImageIds = new Set(images.map((i) => i.id));
  setProgress((p) => ({ ...p, images: images.length }));

  // 5. Cameras (same as transect path — used for camera-name lookup).
  setProgress((p) => ({ ...p, phase: 'cameras' }));
  const cameraResp = await client.models.Camera.camerasByProjectId(
    { projectId },
    { selectionSet: ['id', 'name'], limit: 1000 }
  );
  const cameraNamesById: Record<string, string> = {};
  for (const c of (cameraResp.data ?? []) as Array<{
    id?: string | null;
    name?: string | null;
  }>) {
    if (c?.id && c?.name) cameraNamesById[c.id] = c.name;
  }

  // 6. rawNeighbours — only those edges where BOTH endpoints are in the
  //    neighbourhood. De-dup the way the transect path does.
  const seen = new Set<string>();
  const rawNeighbours: ImageNeighbourType[] = [];
  for (const img of chainImages) {
    for (const n of [
      ...(img.leftNeighbours ?? []),
      ...(img.rightNeighbours ?? []),
    ]) {
      if (n.skipped) continue;
      if (!allImageIds.has(n.image1Id) || !allImageIds.has(n.image2Id)) continue;
      const k = `${n.image1Id}__${n.image2Id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rawNeighbours.push(n);
    }
  }

  // 7. Annotations — per-image, scoped to the set. Covers every category
  //    so foreign-category informational markers still render.
  setProgress((p) => ({ ...p, phase: 'annotations' }));
  const perImage = await Promise.all(
    Array.from(allImageIds).map((imageId) =>
      fetchAllPaginatedResults<AnnotationType>(
        client.models.Annotation.annotationsByImageIdAndSetId,
        {
          imageId,
          setId: { eq: setId },
          limit: 1000,
        }
      )
    )
  );
  const annotations = await attachInfoTagsToAnnotations(
    client,
    perImage.flat(),
    setId
  );
  setProgress((p) => ({ ...p, annotations: annotations.length }));

  const annotationsByImage: Record<string, AnnotationType[]> = {};
  for (const a of annotations) {
    (annotationsByImage[a.imageId] ??= []).push(a);
  }

  setProgress((p) => ({ ...p, phase: 'done' }));
  return {
    category,
    images,
    imagesById,
    annotations,
    annotationsByImage,
    rawNeighbours,
    cameraNamesById,
  };
}
