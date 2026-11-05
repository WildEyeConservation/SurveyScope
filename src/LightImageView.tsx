import { Spinner } from '@/components/ui/spinner';
import { useContext, useEffect, useMemo, useState } from 'react';
import {
  isOnEffort,
  OUTSIDE_SURVEY_AREA,
  type BoundaryStatus,
} from '../shared/boundaryStatus';
import { outsideBoundaryFields } from './annotationBoundary';
import { buildAnnotationFeatureProperties } from './annotator/annotationFeatures';
import MapLibreLightViewer, {
  LightAnnotation,
} from './annotator/MapLibreLightViewer';
import { GlobalContext } from './Context';
import { formatInfoTagsForDisplay } from './infoTags';
import type { ExtendedAnnotationType } from './schemaTypes';
import { useImageInfoTags } from './useInfoTags';
import { fetchAllPaginatedResults } from './utils';

type AnnotationItem = {
  id: string;
  x: number;
  y: number;
  setId: string;
  objectId: string;
  categoryId: string;
  source?: string | null;
  obscured?: boolean | null;
  outsideBoundary?: boolean | null;
  category: { id: string; name: string } | null;
};

export default function LightImageView({
  imageId,
  annotationSetId,
  categoryIds = [],
}: {
  imageId: string;
  annotationSetId: string;
  categoryIds?: string[];
}) {
  const { client } = useContext(GlobalContext)!;
  const [imageMeta, setImageMeta] = useState<{
    width: number;
    height: number;
    boundaryStatus?: BoundaryStatus | null;
  } | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [annotationsLoaded, setAnnotationsLoaded] = useState<boolean>(false);
  const infoTagsByAnnotation = useImageInfoTags(imageId, annotationSetId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAnnotationsLoaded(false);
      // Load image metadata
      const { data: image } = await (client as any).models.Image.get({
        id: imageId,
        selectionSet: ['id', 'width', 'height', 'boundaryStatus'] as const,
      });
      if (!image || cancelled) return;
      setImageMeta({
        width: image.width as number,
        height: image.height as number,
        boundaryStatus: image.boundaryStatus,
      });

      // Load source key for slippy map tiles
      const filesResp = await (client as any).models.ImageFile.imagesByimageId({
        imageId,
        selectionSet: ['id', 'type', 'key'] as const,
      });
      const files = filesResp.data as Array<{
        id: string;
        type: string;
        key: string;
      }>;
      const jpeg = files.find((f) => f.type === 'image/jpeg') || files[0];
      setSourceKey(jpeg?.key || null);

      // Load annotations for this image and set
      const anns = (await (fetchAllPaginatedResults as any)(
        (client as any).models.Annotation.annotationsByImageIdAndSetId,
        {
          imageId,
          setId: { eq: annotationSetId },
          selectionSet: [
            'id',
            'x',
            'y',
            'setId',
            'objectId',
            'categoryId',
            'source',
            'obscured',
            ...outsideBoundaryFields(),
            'category.id',
            'category.name',
          ],
          limit: 10000,
        },
      )) as AnnotationItem[];
      if (cancelled) return;
      setAnnotations(anns || []);
      setAnnotationsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, imageId, annotationSetId]);

  // Filter annotations to only show those IN the categoryIds array (the labels)
  const filteredAnnotations = useMemo(() => {
    if (categoryIds.length === 0) return annotations;
    return annotations.filter((annotation) =>
      categoryIds.includes(annotation.category?.id || ''),
    );
  }, [annotations, categoryIds]);

  // Create color mapping for categories
  const categoryColors = useMemo(() => {
    const colors = [
      '#FF5733',
      '#33FF57',
      '#3357FF',
      '#F333FF',
      '#33FFF8',
      '#FFA833',
      '#8B33FF',
      '#FF3380',
      '#33FF8B',
    ];

    const uniqueCategoryIds: string[] = [];
    const seenCategories = new Set<string>();

    filteredAnnotations.forEach((annotation) => {
      const categoryId = annotation.category?.id || 'Unknown';
      if (!seenCategories.has(categoryId)) {
        seenCategories.add(categoryId);
        uniqueCategoryIds.push(categoryId);
      }
    });

    const categoryColorMap = new Map<string, string>();
    uniqueCategoryIds.forEach((categoryId, index) => {
      const colorIndex = index % colors.length;
      categoryColorMap.set(categoryId, colors[colorIndex]);
    });

    return categoryColorMap;
  }, [filteredAnnotations]);

  const outside = !isOnEffort(imageMeta?.boundaryStatus);
  const lightAnnotations = useMemo<LightAnnotation[]>(
    () =>
      filteredAnnotations.map((a) => {
        const categoryId = a.category?.id || 'Unknown';
        const isPrimary = a.id === a.objectId;
        const infoTags = infoTagsByAnnotation.get(a.id);
        return {
          ...buildAnnotationFeatureProperties(
            a as ExtendedAnnotationType,
            () => categoryColors.get(categoryId) || '#999999',
          ),
          x: a.x,
          y: a.y,
          popupLines: [
            `Label: ${a.category?.name || 'Unknown'}`,
            ...(outside || a.outsideBoundary ? [OUTSIDE_SURVEY_AREA] : []),
            `Sighting: ${isPrimary ? 'Primary' : 'Secondary'}`,
            ...(infoTags?.length
              ? [`Info tags: ${formatInfoTagsForDisplay(infoTags)}`]
              : []),
          ],
        };
      }),
    [filteredAnnotations, categoryColors, infoTagsByAnnotation, outside],
  );

  if (!imageMeta || !sourceKey || !annotationsLoaded)
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <Spinner size='sm' />
        <span className='ms-2'>Loading...</span>
      </div>
    );

  return (
    <MapLibreLightViewer
      image={{ ...imageMeta, id: imageId }}
      sourceKey={sourceKey}
      annotations={lightAnnotations}
      zoomInOnAnnotationClick
    />
  );
}
