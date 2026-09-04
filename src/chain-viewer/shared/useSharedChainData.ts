import { useQuery } from '@tanstack/react-query';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';
import type { ImageNeighbourType, ImageType } from '../../schemaTypes';
import type { LocationOverlayRow } from '../../individual-id/MapLocationOverlay';
import type { AnnotationImageMeta, ChainAnnotation } from '../types';

export interface SharedCategory {
  id: string;
  name: string;
  color: string | null;
  shortcutKey: string | null;
}

export interface SharedChainData {
  share: {
    shareId: string;
    surveyId: string;
    annotationSetId: string;
    surveyName: string | null;
    annotationSetName: string | null;
  } | null;
  annotations: ChainAnnotation[];
  imagesById: Record<string, ImageType>;
  rawNeighbours: ImageNeighbourType[];
  categories: SharedCategory[];
  // Plain records (not Maps) so this query survives react-query's localStorage
  // persistence — JSON round-tripping silently turns Maps into {}.
  sourceKeyByImageId: Record<string, string | undefined>;
  metaByAnnotationId: Record<string, AnnotationImageMeta>;
  locationRowsByImageId: Record<string, LocationOverlayRow[]>;
}

type SharedAnnotationRow = {
  sourceAnnotationId: string;
  x: number;
  y: number;
  imageId: string;
  objectId?: string | null;
  categoryId: string;
  obscured?: boolean | null;
  oov?: boolean | null;
  imageTimestamp?: number | null;
  infoTags?: string[] | null;
};

type SharedImageRow = {
  sourceImageId: string;
  width: number;
  height: number;
  originalPath?: string | null;
  timestamp?: number | null;
  cameraId?: string | null;
  cameraName?: string | null;
  cameraSerial?: string | null;
  sourceKey?: string | null;
};

type SharedLocationRow = LocationOverlayRow & {
  imageId: string;
};

type SharedNeighbourRow = {
  image1Id: string;
  image2Id: string;
  homography?: number[] | null;
  homographySource?: string | null;
  skipped?: boolean | null;
};

type SharedCategoryRow = {
  sourceCategoryId: string;
  name: string;
  color?: string | null;
  shortcutKey?: string | null;
};

/**
 * Loads one chain share's frozen snapshot (annotations, images, neighbours,
 * categories) into the same shapes the live herd view consumes, so the shared
 * harness can reuse buildHerdDisplayPairs / HerdMapPair / ChainTilesModal
 * unchanged. Reviewers read these read-only SharedChain* tables via their
 * `chainshare-<shareId>` group; no Image/ImageFile/Location access is needed.
 */
export function useSharedChainData(shareId: string | undefined) {

  return useQuery<SharedChainData>({
    // Bump when the persisted row shape changes.
    queryKey: ['shared-chain-data', 'v4', shareId],
    enabled: Boolean(shareId),
    staleTime: Infinity,
    queryFn: async () => {
      const id = shareId!;

      const { data: shareRow } = await client.models.ChainShare.get({
        shareId: id,
      });

      const [annRows, imgRows, locRows, nbrRows, catRows] = await Promise.all([
        fetchAllPaginatedResults(
          client.models.SharedChainAnnotation.sharedChainAnnotationsByShareId,
          {
            shareId: id,
            selectionSet: [
              'sourceAnnotationId',
              'x',
              'y',
              'imageId',
              'objectId',
              'categoryId',
              'obscured',
              'oov',
              'imageTimestamp',
              'infoTags',
            ] as const,
            limit: 10000,
          }
        ) as Promise<SharedAnnotationRow[]>,
        fetchAllPaginatedResults(
          client.models.SharedChainImage.sharedChainImagesByShareId,
          {
            shareId: id,
            selectionSet: [
              'sourceImageId',
              'width',
              'height',
              'originalPath',
              'timestamp',
              'cameraId',
              'cameraName',
              'cameraSerial',
              'sourceKey',
            ] as const,
            limit: 10000,
          }
        ) as Promise<SharedImageRow[]>,
        fetchAllPaginatedResults(
          client.models.SharedChainLocation.sharedChainLocationsByShareId,
          {
            shareId: id,
            selectionSet: [
              'imageId',
              'x',
              'y',
              'width',
              'height',
              'confidence',
              'source',
            ] as const,
            limit: 10000,
          }
        ) as Promise<SharedLocationRow[]>,
        fetchAllPaginatedResults(
          client.models.SharedChainNeighbour.sharedChainNeighboursByShareId,
          {
            shareId: id,
            selectionSet: [
              'image1Id',
              'image2Id',
              'homography',
              'homographySource',
              'skipped',
            ] as const,
            limit: 10000,
          }
        ) as Promise<SharedNeighbourRow[]>,
        fetchAllPaginatedResults(
          client.models.SharedChainCategory.sharedChainCategoriesByShareId,
          {
            shareId: id,
            selectionSet: [
              'sourceCategoryId',
              'name',
              'color',
              'shortcutKey',
            ] as const,
            limit: 10000,
          }
        ) as Promise<SharedCategoryRow[]>,
      ]);

      const annotations: ChainAnnotation[] = annRows.map((a) => ({
        id: a.sourceAnnotationId,
        x: a.x,
        y: a.y,
        imageId: a.imageId,
        objectId: a.objectId ?? null,
        categoryId: a.categoryId,
        obscured: !!a.obscured,
        oov: !!a.oov,
        imageTimestamp:
          typeof a.imageTimestamp === 'number' ? a.imageTimestamp : null,
        infoTags: a.infoTags ?? [],
      }));

      const imagesById: Record<string, ImageType> = {};
      const sourceKeyByImageId: Record<string, string | undefined> = {};
      const imageMetaById = new Map<string, SharedImageRow>();
      for (const img of imgRows) {
        imageMetaById.set(img.sourceImageId, img);
        sourceKeyByImageId[img.sourceImageId] = img.sourceKey ?? undefined;
        imagesById[img.sourceImageId] = {
          id: img.sourceImageId,
          width: img.width,
          height: img.height,
          originalPath: img.originalPath ?? null,
          timestamp: img.timestamp ?? null,
          cameraId: img.cameraId ?? null,
        } as unknown as ImageType;
      }

      const locationRowsByImageId: Record<string, LocationOverlayRow[]> = {};
      for (const loc of locRows) {
        (locationRowsByImageId[loc.imageId] ??= []).push({
          x: loc.x,
          y: loc.y,
          width: loc.width,
          height: loc.height,
          confidence: loc.confidence,
          source: loc.source,
        });
      }

      const rawNeighbours: ImageNeighbourType[] = nbrRows
        .filter((n) => !n.skipped)
        .map(
          (n) =>
            ({
              image1Id: n.image1Id,
              image2Id: n.image2Id,
              homography: n.homography ?? null,
              homographySource: n.homographySource ?? null,
              skipped: false,
            }) as unknown as ImageNeighbourType
        );

      const categories: SharedCategory[] = catRows.map((c) => ({
        id: c.sourceCategoryId,
        name: c.name,
        color: c.color ?? null,
        shortcutKey: c.shortcutKey ?? null,
      }));

      // Per-annotation image meta the tile grid needs, straight from the
      // snapshot (no ImageFile lookup — sourceKey is precomputed).
      const metaByAnnotationId: Record<string, AnnotationImageMeta> = {};
      for (const a of annotations) {
        const img = imageMetaById.get(a.imageId);
        if (!img) continue;
        metaByAnnotationId[a.id] = {
          imageId: a.imageId,
          width: img.width,
          height: img.height,
          originalPath: img.originalPath ?? null,
          cameraId: img.cameraId ?? null,
          cameraName: img.cameraName ?? null,
          cameraSerial: img.cameraSerial ?? null,
          sourceKey: img.sourceKey ?? null,
        };
      }

      return {
        share: shareRow
          ? {
              shareId: shareRow.shareId,
              surveyId: shareRow.surveyId,
              annotationSetId: shareRow.annotationSetId,
              surveyName: shareRow.surveyName ?? null,
              annotationSetName: shareRow.annotationSetName ?? null,
            }
          : null,
        annotations,
        imagesById,
        rawNeighbours,
        categories,
        sourceKeyByImageId,
        metaByAnnotationId,
        locationRowsByImageId,
      };
    },
  });
}
