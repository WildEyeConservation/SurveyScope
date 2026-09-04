import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';
import type {
  AnnotationType,
  CategoryType,
  ImageNeighbourType,
  ImageType,
} from '../../schemaTypes';
import { attachInfoTagsToAnnotations } from '../../infoTags';
import { useCurrentProject } from '../../data/projectScope';

type ImageWithNeighbours = Pick<
  ImageType,
  'id' | 'width' | 'height' | 'originalPath' | 'timestamp' | 'cameraId'
> & {
  leftNeighbours?: ImageNeighbourType[] | null;
  rightNeighbours?: ImageNeighbourType[] | null;
};

export interface PairLoadProgress {
  phase:
    | 'idle'
    | 'images'
    | 'category'
    | 'annotations'
    | 'chain'
    | 'done';
  annotations: number;
}

interface UsePairDataInput {
  image1Id: string | undefined;
  image2Id: string | undefined;
  categoryId: string | undefined;
  annotationSetId: string | undefined;
}

// Plain JSON only — React Query persists this to localStorage.
export interface PairData {
  category: CategoryType | null;
  imageA: ImageType;
  imageB: ImageType;
  imagesById: Record<string, ImageType>;
  neighbour: ImageNeighbourType | null;
  annotations: AnnotationType[];
}

/**
 * Loads everything needed to edit a single image pair: both images (with
 * their neighbour rows), the active category, every annotation on those two
 * images in the set (all categories — the workflow filters to the chosen
 * one, the maps show the rest as informational markers), and the chain
 * members of any chain that extends beyond the pair — so accepting /
 * deleting links can re-root the full chain rather than silently leaving
 * stragglers on other images.
 */
export function usePairData(input: UsePairDataInput) {
  const project = useCurrentProject();
  const { image1Id, image2Id, categoryId, annotationSetId } = input;

  const enabled = Boolean(
    image1Id &&
      image2Id &&
      categoryId &&
      annotationSetId &&
      project.id
  );

  const [progress, setProgress] = useState<PairLoadProgress>({
    phase: 'idle',
    annotations: 0,
  });

  const queryKey = useMemo(
    () => [
      'individual-id-pair',
      image1Id,
      image2Id,
      categoryId,
      annotationSetId,
    ],
    [image1Id, image2Id, categoryId, annotationSetId]
  );

  const query = useQuery<PairData>({
    queryKey,
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      setProgress({ phase: 'images', annotations: 0 });
      const [img1Resp, img2Resp] = await Promise.all([
        (client.models.Image as any).get(
          { id: image1Id! },
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
        ),
        (client.models.Image as any).get(
          { id: image2Id! },
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
        ),
      ]);
      const img1 = img1Resp?.data as ImageWithNeighbours | null;
      const img2 = img2Resp?.data as ImageWithNeighbours | null;
      if (!img1 || !img2) {
        throw new Error(
          `Could not load one or both images (${image1Id}, ${image2Id}).`
        );
      }

      // Find the neighbour row between the two images, in either direction.
      const candidates = [
        ...(img1.leftNeighbours ?? []),
        ...(img1.rightNeighbours ?? []),
      ];
      let neighbour: ImageNeighbourType | null = null;
      for (const n of candidates) {
        if (n.skipped) continue;
        const ab = n.image1Id === img1.id && n.image2Id === img2.id;
        const ba = n.image1Id === img2.id && n.image2Id === img1.id;
        if (ab || ba) {
          neighbour = n;
          break;
        }
      }

      setProgress((p) => ({ ...p, phase: 'category' }));
      const categoryResp = await client.models.Category.get({
        id: categoryId!,
      });
      const category = (categoryResp?.data ?? null) as CategoryType | null;

      setProgress((p) => ({ ...p, phase: 'annotations', annotations: 0 }));
      const [annsA, annsB] = await Promise.all([
        fetchAllPaginatedResults<AnnotationType>(
          (client.models.Annotation as any).annotationsByImageIdAndSetId,
          { imageId: img1.id, setId: { eq: annotationSetId! }, limit: 1000 }
        ),
        fetchAllPaginatedResults<AnnotationType>(
          (client.models.Annotation as any).annotationsByImageIdAndSetId,
          { imageId: img2.id, setId: { eq: annotationSetId! }, limit: 1000 }
        ),
      ]);
      // Keep every category — the workflow filters to `categoryId`, but the
      // maps also show the other categories as informational markers.
      const pairAnnotations = [...annsA, ...annsB];
      setProgress((p) => ({ ...p, annotations: pairAnnotations.length }));

      // Chain expansion: every chain root referenced by a pair-local
      // annotation, plus every secondary that points at that root. Without
      // this, merging two chains via Accept would only update the part of
      // each chain that happens to live on these two images, and the rest
      // would silently keep its old objectId.
      setProgress((p) => ({ ...p, phase: 'chain' }));
      const rootIds = new Set<string>();
      for (const a of pairAnnotations) {
        if (a.objectId) rootIds.add(a.objectId);
      }
      // Skip ids we already have — and Annotation.get on every root would be
      // wasted work if the root annotation happens to be in pairAnnotations.
      const localIds = new Set(pairAnnotations.map((a) => a.id));
      const rootIdsToFetch = Array.from(rootIds).filter(
        (id) => !localIds.has(id)
      );

      const chainExtras: AnnotationType[] = [];
      if (rootIds.size > 0) {
        const results = await Promise.all(
          Array.from(rootIds).map(async (rootId) => {
            const byObj = await fetchAllPaginatedResults<AnnotationType>(
              (client.models.Annotation as any).annotationsByObjectId,
              { objectId: rootId, limit: 1000 }
            );
            return byObj;
          })
        );
        const rootResults = await Promise.all(
          rootIdsToFetch.map(async (rootId) => {
            const resp = await client.models.Annotation.get({ id: rootId });
            return (resp?.data ?? null) as AnnotationType | null;
          })
        );
        const seen = new Set<string>(localIds);
        for (const list of results) {
          for (const a of list) {
            if (seen.has(a.id)) continue;
            chainExtras.push(a);
            seen.add(a.id);
          }
        }
        for (const a of rootResults) {
          if (!a) continue;
          if (seen.has(a.id)) continue;
          chainExtras.push(a);
          seen.add(a.id);
        }
      }

      const annotations = await attachInfoTagsToAnnotations(client, [
        ...pairAnnotations,
        ...chainExtras,
      ], annotationSetId!);
      const imagesById: Record<string, ImageType> = {
        [img1.id]: img1 as unknown as ImageType,
        [img2.id]: img2 as unknown as ImageType,
      };
      const extraImageIds = Array.from(
        new Set(
          annotations
            .map((a) => a.imageId)
            .filter((id) => id !== img1.id && id !== img2.id)
        )
      );
      const extraImages = await Promise.all(
        extraImageIds.map(async (id) => {
          const resp = await (client.models.Image as any).get(
            { id },
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
          );
          return (resp?.data ?? null) as ImageType | null;
        })
      );
      for (const img of extraImages) {
        if (img) imagesById[img.id] = img;
      }
      setProgress({ phase: 'done', annotations: annotations.length });

      return {
        category,
        imageA: img1 as unknown as ImageType,
        imageB: img2 as unknown as ImageType,
        imagesById,
        neighbour,
        annotations,
      };
    },
  });

  return useMemo(() => ({ ...query, progress }), [query, progress]);
}
