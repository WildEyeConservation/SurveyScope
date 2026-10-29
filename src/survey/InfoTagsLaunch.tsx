import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { LoadingProgressCard } from './LoadingProgressCard';
import type { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { fetchAllPaginatedResults } from '../utils';
import { loadRows } from '../rowChunks';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { logAdminAction } from '../utils/adminActionLogger';
import { shouldIgnoreLaunchError } from './QCReview';
import { parseLaunchResponse } from './launchResponse';
import { pickZoomPreviewCandidates } from './zoomPreview';
import ZoomSetting from './ZoomSetting';

type LaunchHandler = {
  execute: (
    onProgress: (message: string) => void,
    onLaunchConfirmed: () => void
  ) => Promise<void>;
};

type CategoryOption = { id: string; name: string };
type AnnotationSummary = {
  id: string;
  categoryId: string;
  imageId: string;
  infoTaggedBy: string | null;
};

export default function InfoTagsLaunch({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setInfoTagsLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: (disabled: boolean) => void;
  setInfoTagsLaunchHandler: (handler: LaunchHandler | null) => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationSummary[]>([]);
  const [infoTagCount, setInfoTagCount] = useState(0);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [batchSize, setBatchSize] = useState(200);
  const [hidden, setHidden] = useState(false);
  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState({
    categories: 0,
    categoriesDone: false,
    annotations: 0,
    annotationsDone: false,
    infoTags: 0,
    infoTagsDone: false,
  });

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadStatus({
      categories: 0,
      categoriesDone: false,
      annotations: 0,
      annotationsDone: false,
      infoTags: 0,
      infoTagsDone: false,
    });
    const categoriesPromise = fetchAllPaginatedResults(
      client.models.Category.categoriesByAnnotationSetId,
      {
        annotationSetId: annotationSet.id,
        selectionSet: ['id', 'name'] as const,
        limit: 1000,
      },
      (count) => {
        if (mounted) setLoadStatus((state) => ({ ...state, categories: count }));
      }
    ).then((rows) => {
      if (mounted) {
        setLoadStatus((state) => ({
          ...state,
          categories: rows.length,
          categoriesDone: true,
        }));
      }
      return rows;
    });
    const annotationsPromise = loadRows(
      client,
      'annotationsByAnnotationSetId',
      annotationSet.id,
      ['categoryId', 'imageId', 'infoTaggedBy'],
      {
        onProgress: (count) => {
          if (mounted) setLoadStatus((state) => ({ ...state, annotations: count }));
        },
      }
    ).then((rows) => {
      if (mounted) {
        setLoadStatus((state) => ({
          ...state,
          annotations: rows.length,
          annotationsDone: true,
        }));
      }
      return rows;
    });
    const infoTagsPromise = fetchAllPaginatedResults(
      client.models.InfoTag.infoTagsByAnnotationSetId,
      {
        annotationSetId: annotationSet.id,
        selectionSet: ['id'] as const,
        limit: 1000,
      },
      (count) => {
        if (mounted) setLoadStatus((state) => ({ ...state, infoTags: count }));
      }
    ).then((rows) => {
      if (mounted) {
        setLoadStatus((state) => ({
          ...state,
          infoTags: rows.length,
          infoTagsDone: true,
        }));
      }
      return rows;
    });

    Promise.all([categoriesPromise, annotationsPromise, infoTagsPromise])
      .then(([categoryRows, annotationRows, infoTagRows]) => {
        if (!mounted) return;
        setCategories(categoryRows);
        setAnnotations(
          annotationRows.flatMap((row) =>
            row.categoryId && row.imageId
              ? [
                  {
                    id: row.id,
                    categoryId: row.categoryId,
                    imageId: row.imageId,
                    infoTaggedBy: row.infoTaggedBy ?? null,
                  },
                ]
              : []
          )
        );
        setInfoTagCount(infoTagRows.length);
      })
      .catch((error) => console.error('Failed to load info tag launch data', error))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [annotationSet.id, client]);

  const availableCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      counts.set(annotation.categoryId, (counts.get(annotation.categoryId) ?? 0) + 1);
    }
    return categories
      .filter((category) => counts.has(category.id))
      .map((category) => ({ ...category, count: counts.get(category.id) ?? 0 }));
  }, [annotations, categories]);

  const selected = useMemo(() => {
    const ids = new Set(selectedCategoryIds);
    return annotations.filter((annotation) => ids.has(annotation.categoryId));
  }, [annotations, selectedCategoryIds]);
  const selectedImageCount = useMemo(
    () => new Set(selected.map((annotation) => annotation.imageId)).size,
    [selected]
  );
  const taggedCount = selected.filter((annotation) => annotation.infoTaggedBy).length;
  const untaggedCount = selected.length - taggedCount;

  useEffect(() => {
    setLaunchDisabled(
      loading ||
        infoTagCount === 0 ||
        selectedCategoryIds.length === 0 ||
        untaggedCount === 0 ||
        launching
    );
  }, [
    infoTagCount,
    launching,
    loading,
    selectedCategoryIds.length,
    setLaunchDisabled,
    untaggedCount,
  ]);

  const selectionRef = useRef(selectedCategoryIds);
  const batchSizeRef = useRef(batchSize);
  const hiddenRef = useRef(hidden);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    selectionRef.current = selectedCategoryIds;
  }, [selectedCategoryIds]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  useEffect(() => {
    setInfoTagsLaunchHandler({
      execute: async (onProgress, onLaunchConfirmed) => {
        const categoryIds = selectionRef.current;
        if (categoryIds.length === 0) return;
        const categoryNames = categoryIds.map(
          (id) => categories.find((category) => category.id === id)?.name ?? id
        );
        onLaunchConfirmed();
        onProgress('Submitting informational tagging request...');
        const message = await sendLaunchRequest(client, {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          categoryIds,
          categoryNames,
          batchSize: batchSizeRef.current,
          hidden: hiddenRef.current,
          zoom: zoomRef.current,
        });
        onProgress(message ?? 'Informational tagging launch submitted');
        await logAdminAction(
          client,
          user.userId,
          `Launched Info Tags for ${categoryNames.join(', ')} in annotation set "${annotationSet.name}"`,
          project.id,
          project.organizationId
        ).catch(console.error);
      },
    });
    return () => setInfoTagsLaunchHandler(null);
  }, [
    annotationSet.id,
    annotationSet.name,
    categories,
    client,
    project.id,
    project.organizationId,
    setInfoTagsLaunchHandler,
    user.userId,
  ]);

  return (
    <div className='px-4 pb-4 pt-1'>
      <div className='flex flex-col gap-4 mt-2'>
        {loading ? (
          <LoadingProgressCard
            title='Loading Info Tags data...'
            rows={[
              {
                label: 'Labels',
                count: loadStatus.categories,
                done: loadStatus.categoriesDone,
              },
              {
                label: 'Annotations',
                count: loadStatus.annotations,
                done: loadStatus.annotationsDone,
              },
              {
                label: 'Info Tags',
                count: loadStatus.infoTags,
                done: loadStatus.infoTagsDone,
              },
            ]}
          />
        ) : infoTagCount === 0 ? (
          <Alert variant='warning' className='mb-0'>
            Define Info Tags first - Edit annotation set → Info Tags.
          </Alert>
        ) : availableCategories.length === 0 ? (
          <Alert variant='warning' className='mb-0'>
            No labels with annotations found for this annotation set.
          </Alert>
        ) : (
          <>
            <div>
              <Label className='mb-0'>Labels to tag</Label>
              <span className='text-muted-foreground block mb-1' style={{ fontSize: 12 }}>
                Select one or more species whose annotations should be tagged.
              </span>
              <div
                className='border border-dark p-2'
                style={{ maxHeight: 220, overflowY: 'auto' }}
              >
                {availableCategories.map((category) => (
                  <label key={category.id} className='mb-0.5 flex items-center gap-2'>
                    <Checkbox
                      checked={selectedCategoryIds.includes(category.id)}
                      disabled={launching}
                      onCheckedChange={(checked) =>
                        setSelectedCategoryIds((current) =>
                          checked === true
                            ? [...current, category.id]
                            : current.filter((id) => id !== category.id)
                        )
                      }
                    />
                    {`${category.name} (${category.count})`}
                  </label>
                ))}
              </div>
            </div>

            {selected.length > 0 && (
              <div
                className='border border-dark shadow-sm p-2 text-white'
                style={{ backgroundColor: '#697582', fontSize: 12 }}
              >
                <strong>{selected.length.toLocaleString()}</strong> annotations across{' '}
                <strong>{selectedImageCount.toLocaleString()}</strong> images -{' '}
                <strong>{taggedCount.toLocaleString()}</strong> already tagged
                {untaggedCount === 0 && (
                  <div className='mt-1 text-warning'>
                    All selected annotations have already been tagged.
                  </div>
                )}
              </div>
            )}

            <ZoomSetting
              mode='offset'
              zoom={zoom}
              onChange={setZoom}
              loadCandidates={async () => pickZoomPreviewCandidates(selected)}
              disabled={launching || selected.length === 0}
            />

            <label className='mb-0 flex items-center gap-2'>
              <Switch
                checked={showAdvancedOptions}
                onCheckedChange={() => setShowAdvancedOptions((value) => !value)}
                disabled={launching}
              />
              Show Advanced Options
            </label>
            {showAdvancedOptions && (
              <div
                className='flex flex-col gap-4 border border-dark shadow-sm p-2'
                style={{ backgroundColor: '#697582' }}
              >
                <div>
                  <Label className='mb-0'>Batch Size</Label>
                  <span className='text-muted-foreground block mb-1' style={{ fontSize: 12 }}>
                    The number of images a user can pick up at a time.
                  </span>
                  <Input
                    type='number'
                    min={1}
                    value={batchSize}
                    onChange={(event) => setBatchSize(Number(event.target.value))}
                    disabled={launching}
                  />
                </div>
                <label className='mb-0 flex items-center gap-2'>
                  <Switch
                    checked={hidden}
                    onCheckedChange={() => setHidden((value) => !value)}
                    disabled={launching}
                  />
                  Hide Job From Non-Admin Workers
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

async function sendLaunchRequest(
  client: DataClient,
  payload: Record<string, unknown>
): Promise<string | undefined> {
  try {
    const result = await client.mutations.launchInfoTags(
      { request: JSON.stringify(payload) },
      { retry: false }
    );
    const body = parseLaunchResponse(result, 'Informational tagging launch failed');
    return typeof body.message === 'string' ? body.message : undefined;
  } catch (error) {
    // A timeout does not mean the launch failed - the Lambda keeps going.
    if (shouldIgnoreLaunchError(error)) return undefined;
    throw error;
  }
}
