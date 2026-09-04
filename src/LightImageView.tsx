import { useEffect, useMemo, useState } from 'react';
import { client } from './stores/appClient';
import { fetchAllPaginatedResults } from './utils';
import { Spinner } from 'react-bootstrap';
import MapLibreLightViewer, {
  LightAnnotation,
} from './annotator/MapLibreLightViewer';
import { useImageInfoTags } from './useInfoTags';
import { formatInfoTagsForDisplay } from './infoTags';
import { buildAnnotationFeatureProperties } from './annotator/annotationFeatures';
import type { ExtendedAnnotationType } from './schemaTypes';

type AnnotationItem = {
  id: string;
  x: number;
  y: number;
  setId: string;
  objectId: string;
  categoryId: string;
  source?: string | null;
  obscured?: boolean | null;
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
  const [imageMeta, setImageMeta] = useState<{
    width: number;
    height: number;
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
        selectionSet: ['id', 'width', 'height'] as const,
      });
      if (!image || cancelled) return;
      setImageMeta({
        width: image.width as number,
        height: image.height as number,
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
            'category.id',
            'category.name',
          ] as const,
          limit: 10000,
        }
      )) as AnnotationItem[];
      if (cancelled) return;
      setAnnotations(anns || []);
      setAnnotationsLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [imageId, annotationSetId]);

  // Filter annotations to only show those IN the categoryIds array (the labels)
  const filteredAnnotations = useMemo(() => {
    if (categoryIds.length === 0) return annotations;
    return annotations.filter((annotation) =>
      categoryIds.includes(annotation.category?.id || '')
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

  const lightAnnotations = useMemo<LightAnnotation[]>(
    () =>
      filteredAnnotations.map((a) => {
        const categoryId = a.category?.id || 'Unknown';
        const isPrimary = a.id === a.objectId;
        const infoTags = infoTagsByAnnotation.get(a.id);
        return {
          ...buildAnnotationFeatureProperties(
            a as ExtendedAnnotationType,
            () => categoryColors.get(categoryId) || '#999999'
          ),
          x: a.x,
          y: a.y,
          popupLines: [
            `Label: ${a.category?.name || 'Unknown'}`,
            `Sighting: ${isPrimary ? 'Primary' : 'Secondary'}`,
            ...(infoTags?.length
              ? [`Info tags: ${formatInfoTagsForDisplay(infoTags)}`]
              : []),
          ],
        };
      }),
    [filteredAnnotations, categoryColors, infoTagsByAnnotation]
  );

  if (!imageMeta || !sourceKey || !annotationsLoaded)
    return (
      <div className='w-100 h-100 d-flex align-items-center justify-content-center'>
        <Spinner size='sm' />
        <span className='ms-2'>Loading...</span>
      </div>
    );

  return (
    <MapLibreLightViewer
      image={imageMeta}
      sourceKey={sourceKey}
      annotations={lightAnnotations}
      zoomInOnAnnotationClick
    />
  );
}
