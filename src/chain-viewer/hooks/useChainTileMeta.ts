import { useEffect, useState } from 'react';
import { client } from '../../stores/appClient';
import type { AnnotationImageMeta, Chain } from '../types';
import {
  selectSourceKeyForImage,
  type ImageFileRow,
} from '../utils/imageSourceKey';

type ChainImageRow = {
  width: number;
  height: number;
  originalPath?: string | null;
  cameraId?: string | null;
  cameraSerial?: string | null;
  camera?: { name?: string | null } | null;
};

type GetChainImage = (
  input: { id: string },
  options: { selectionSet: readonly string[] }
) => Promise<{ data?: ChainImageRow | null }>;

type ListImageFilesByImageId = (
  input: { imageId: string },
  options: { selectionSet: readonly string[] }
) => Promise<{ data?: ImageFileRow[] | null }>;

/**
 * Lazily fetches per-annotation image / camera metadata for a chain's tiles
 * (dimensions + JPEG source key), the same data the tile grid needs to render
 * a centred crop. De-dupes by imageId and caches across calls so re-opening
 * the same chain is instant. Ported from the original ChainViewerHarness.
 */
export function useChainTileMeta(chain: Chain | null) {
  const [metaByAnnotationId, setMetaByAnnotationId] = useState<
    Map<string, AnnotationImageMeta>
  >(() => new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!chain) return;
    const needed = chain.annotations.filter(
      (a) => !metaByAnnotationId.has(a.id)
    );
    if (needed.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const uniqueImageIds = Array.from(new Set(needed.map((a) => a.imageId)));
      const imageById = new Map<string, ChainImageRow | null>();
      const sourceKeyById = new Map<string, string | null>();

      await Promise.all(
        uniqueImageIds.map(async (imageId) => {
          try {
            const getImage = client.models.Image.get as unknown as GetChainImage;
            const listImageFilesByImageId = client.models.ImageFile
              .imagesByimageId as unknown as ListImageFilesByImageId;
            const [imgResp, fileResp] = await Promise.all([
              getImage(
                { id: imageId },
                {
                  selectionSet: [
                    'id',
                    'width',
                    'height',
                    'originalPath',
                    'cameraId',
                    'cameraSerial',
                    'camera.name',
                  ] as const,
                }
              ),
              listImageFilesByImageId(
                { imageId },
                { selectionSet: ['key', 'path', 'type'] as const }
              ),
            ]);
            const image = imgResp?.data ?? null;
            imageById.set(imageId, image);
            sourceKeyById.set(
              imageId,
              selectSourceKeyForImage(fileResp?.data ?? [], image?.originalPath)
            );
          } catch (err) {
            console.error('Failed to fetch chain tile meta', imageId, err);
            imageById.set(imageId, null);
            sourceKeyById.set(imageId, null);
          }
        })
      );

      if (cancelled) return;

      setMetaByAnnotationId((prev) => {
        const next = new Map(prev);
        for (const a of needed) {
          const img = imageById.get(a.imageId);
          if (!img) continue;
          next.set(a.id, {
            imageId: a.imageId,
            width: img.width,
            height: img.height,
            originalPath: img.originalPath ?? null,
            cameraId: img.cameraId ?? null,
            cameraName: img.camera?.name ?? null,
            cameraSerial: img.cameraSerial ?? null,
            sourceKey: sourceKeyById.get(a.imageId) ?? null,
          });
        }
        return next;
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [chain, metaByAnnotationId]);

  return { metaByAnnotationId, loading };
}
