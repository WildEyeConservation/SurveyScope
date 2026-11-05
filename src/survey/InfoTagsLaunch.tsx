import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import type { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { loadRows } from '../rowChunks';
import { fetchAllPaginatedResults } from '../utils';
import { logAdminAction } from '../utils/adminActionLogger';
import { plural, useLaunchLabel } from './launchLabel';
import {
  AdvancedOptions,
  Banner,
  LaunchSummary,
  SettingRow,
} from './launchParts';
import { parseLaunchResponse } from './launchResponse';
import { LoadingProgressCard } from './LoadingProgressCard';
import { shouldIgnoreLaunchError } from './QCReview';
import { pickZoomPreviewCandidates } from './zoomPreview';
import ZoomSetting from './ZoomSetting';

type LaunchHandler = {
  execute: (
    onProgress: (message: string) => void,
    onLaunchConfirmed: () => void,
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
  const [zoom, setZoom] = useState<number | undefined>(undefined);
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
        if (mounted)
          setLoadStatus((state) => ({ ...state, categories: count }));
      },
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
          if (mounted)
            setLoadStatus((state) => ({ ...state, annotations: count }));
        },
      },
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
      },
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
              : [],
          ),
        );
        setInfoTagCount(infoTagRows.length);
      })
      .catch((error) =>
        console.error('Failed to load info tag launch data', error),
      )
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
      counts.set(
        annotation.categoryId,
        (counts.get(annotation.categoryId) ?? 0) + 1,
      );
    }
    return categories
      .filter((category) => counts.has(category.id))
      .map((category) => ({
        ...category,
        count: counts.get(category.id) ?? 0,
      }));
  }, [annotations, categories]);

  const selected = useMemo(() => {
    const ids = new Set(selectedCategoryIds);
    return annotations.filter((annotation) => ids.has(annotation.categoryId));
  }, [annotations, selectedCategoryIds]);
  const selectedImageCount = useMemo(
    () => new Set(selected.map((annotation) => annotation.imageId)).size,
    [selected],
  );
  const taggedCount = selected.filter(
    (annotation) => annotation.infoTaggedBy,
  ).length;
  const untaggedCount = selected.length - taggedCount;

  useEffect(() => {
    setLaunchDisabled(
      loading ||
        infoTagCount === 0 ||
        selectedCategoryIds.length === 0 ||
        untaggedCount === 0 ||
        launching,
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
  const [jobName, setJobName] = useState('');
  const jobNameRef = useRef(jobName);
  jobNameRef.current = jobName;
  const batchSizeRef = useRef(batchSize);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    selectionRef.current = selectedCategoryIds;
  }, [selectedCategoryIds]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);

  useEffect(() => {
    setInfoTagsLaunchHandler({
      execute: async (onProgress, onLaunchConfirmed) => {
        const categoryIds = selectionRef.current;
        if (categoryIds.length === 0) return;
        const categoryNames = categoryIds.map(
          (id) => categories.find((category) => category.id === id)?.name ?? id,
        );
        onLaunchConfirmed();
        onProgress('Submitting informational tagging request...');
        const message = await sendLaunchRequest(client, {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          categoryIds,
          categoryNames,
          queueName: jobNameRef.current.trim() || undefined,
          batchSize: batchSizeRef.current,
          hidden: false,
          zoom: zoomRef.current,
        });
        onProgress(message ?? 'Informational tagging launch submitted');
        await logAdminAction(
          client,
          user.userId,
          `Launched Info Tags for ${categoryNames.join(', ')} in annotation set "${annotationSet.name}"`,
          project.id,
          project.organizationId,
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

  useLaunchLabel(
    selectedImageCount ? `Launch ${plural(selectedImageCount, 'image')}` : null,
    !loading && infoTagCount === 0
      ? 'Define info tags for this annotation set first'
      : !loading && availableCategories.length === 0
        ? 'There are no annotations to tag yet'
        : !loading && selected.length === 0
          ? 'Pick at least one label'
          : undefined,
  );

  return (
    <div className='flex flex-col gap-4 p-4'>
      {loading ? (
        <LoadingProgressCard
          title='Loading annotations...'
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
              label: 'Info tags',
              count: loadStatus.infoTags,
              done: loadStatus.infoTagsDone,
            },
          ]}
        />
      ) : infoTagCount === 0 ? (
        <Banner tone='warning'>
          This annotation set has no info tags yet. Add them in Edit annotation
          set › Info Tags.
        </Banner>
      ) : availableCategories.length === 0 ? (
        <Banner tone='warning'>
          This annotation set has no annotations to tag yet.
        </Banner>
      ) : (
        <>
          <div>
            <Label className='mb-1'>Labels to tag</Label>
            <div className='max-h-60 overflow-y-auto border border-dark bg-white/[0.07] text-sm'>
              {availableCategories.map((category) => {
                const checked = selectedCategoryIds.includes(category.id);
                return (
                  <label
                    key={category.id}
                    className='mb-0 flex cursor-pointer items-center gap-3 border-b border-white/[0.08] px-3 py-2 last:border-b-0 hover:bg-white/5'
                  >
                    <Switch
                      checked={checked}
                      disabled={launching}
                      onCheckedChange={(next) =>
                        setSelectedCategoryIds((current) =>
                          next
                            ? [...current, category.id]
                            : current.filter((id) => id !== category.id),
                        )
                      }
                    />
                    <span className='flex-1'>{category.name}</span>
                    <span className='text-muted-foreground tabular-nums'>
                      {plural(category.count, 'annotation')}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {selected.length > 0 &&
            (untaggedCount === 0 ? (
              <Banner tone='info'>
                All {plural(selected.length, 'selected annotation')} are already
                tagged.
              </Banner>
            ) : (
              <LaunchSummary value={selectedImageCount.toLocaleString()}>
                {selectedImageCount === 1 ? 'image' : 'images'} with{' '}
                {plural(selected.length, 'annotation')} to tag
                <br />
                {taggedCount.toLocaleString()} already tagged
              </LaunchSummary>
            ))}

          <div className='grid gap-3 sm:grid-cols-2'>
            <div>
              <Label className='mb-1'>Batch size</Label>
              <Input
                type='number'
                min={1}
                title='The number of images a user can pick up at a time'
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
                disabled={launching}
              />
            </div>
            <ZoomSetting
              mode='offset'
              zoom={zoom}
              onChange={setZoom}
              loadCandidates={async () => pickZoomPreviewCandidates(selected)}
              disabled={launching || selected.length === 0}
            />
          </div>

          <AdvancedOptions disabled={launching}>
            <SettingRow label='Job name' hint='Shown on the Jobs page'>
              <Input
                type='text'
                aria-label='Job name'
                placeholder={
                  categories
                    .filter((c) => selectedCategoryIds.includes(c.id))
                    .map((c) => c.name)
                    .join(', ') || 'Info Tags'
                }
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                disabled={launching}
              />
            </SettingRow>
          </AdvancedOptions>
        </>
      )}
    </div>
  );
}

async function sendLaunchRequest(
  client: DataClient,
  payload: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const result = await client.mutations.launchInfoTags(
      { request: JSON.stringify(payload) },
      { retry: false },
    );
    const body = parseLaunchResponse(
      result,
      'Informational tagging launch failed',
    );
    return typeof body.message === 'string' ? body.message : undefined;
  } catch (error) {
    // A timeout does not mean the launch failed - the Lambda keeps going.
    if (shouldIgnoreLaunchError(error)) return undefined;
    throw error;
  }
}
