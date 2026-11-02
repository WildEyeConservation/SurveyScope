import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DataClient } from '../../amplify/shared/data-schema.generated';
import { Schema } from '../amplify/client-schema';
import { useUsers } from '../apiInterface';
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
import { LoadingProgressCard } from './LoadingProgressCard';
import { pickZoomPreviewCandidates } from './zoomPreview';
import ZoomSetting from './ZoomSetting';

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void,
  ) => Promise<void>;
};

type CategoryOption = {
  id: string;
  name: string;
  shortcutKey?: string | null;
};

// Per-query load progress so labels and the (potentially large) annotation
// fetch each show their own live count rather than one opaque status line.
type LoadStatus = {
  categories: number;
  categoriesDone: boolean;
  annotations: number;
  annotationsDone: boolean;
};

const INITIAL_LOAD_STATUS: LoadStatus = {
  categories: 0,
  categoriesDone: false,
  annotations: 0,
  annotationsDone: false,
};

export default function QCReview({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setQCLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
  setQCLaunchHandler: React.Dispatch<
    React.SetStateAction<LaunchHandler | null>
  >;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;

  // Data loading
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [allAnnotations, setAllAnnotations] = useState<
    Array<{
      id: string;
      categoryId: string;
      reviewCatId: string | null;
      owner: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(INITIAL_LOAD_STATUS);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

  // Launch settings
  const [samplePercent, setSamplePercent] = useState<number>(10);
  const [batchSize, setBatchSize] = useState<number>(200);
  const [zoom, setZoom] = useState<number | undefined>(undefined);

  // Annotator filter
  const [selectedAnnotatorIds, setSelectedAnnotatorIds] = useState<string[]>(
    [],
  );

  const { users } = useUsers();
  const userMap = useMemo(() => {
    return users.reduce(
      (acc, user) => {
        acc[user.id] = user.name ?? user.email ?? user.id;
        return acc;
      },
      {} as Record<string, string>,
    );
  }, [users]);

  // Categories that have annotations, with completion status
  const availableCategories = useMemo(() => {
    const catMap = new Map<string, { total: number; unreviewed: number }>();
    for (const a of allAnnotations) {
      let entry = catMap.get(a.categoryId);
      if (!entry) {
        entry = { total: 0, unreviewed: 0 };
        catMap.set(a.categoryId, entry);
      }
      entry.total++;
      if (!a.reviewCatId) entry.unreviewed++;
    }
    return categories
      .filter((c) => catMap.has(c.id))
      .map((c) => ({
        ...c,
        total: catMap.get(c.id)!.total,
        unreviewed: catMap.get(c.id)!.unreviewed,
        complete: catMap.get(c.id)!.unreviewed === 0,
      }));
  }, [categories, allAnnotations]);

  // Annotations for the selected category
  const categoryAnnotations = useMemo(() => {
    if (!selectedCategoryId) return [];
    return allAnnotations.filter((a) => a.categoryId === selectedCategoryId);
  }, [allAnnotations, selectedCategoryId]);

  const totalCount = categoryAnnotations.length;
  const unreviewedCount = categoryAnnotations.filter(
    (a) => !a.reviewCatId,
  ).length;

  // Distinct annotators who have annotations in the selected category
  const annotatorOptions = useMemo(() => {
    const ownerIds = new Set<string>();
    for (const a of categoryAnnotations) {
      if (a.owner) ownerIds.add(a.owner);
    }
    return Array.from(ownerIds).sort((a, b) =>
      (userMap[a] ?? a).localeCompare(userMap[b] ?? b),
    );
  }, [categoryAnnotations, userMap]);

  // Computed sample size (respects annotator filter)
  const filteredUnreviewedCount = useMemo(() => {
    if (!selectedCategoryId) return null;
    let candidates = categoryAnnotations.filter((a) => !a.reviewCatId);
    if (selectedAnnotatorIds.length > 0) {
      const filterSet = new Set(selectedAnnotatorIds);
      candidates = candidates.filter((a) => a.owner && filterSet.has(a.owner));
    }
    return candidates.length;
  }, [categoryAnnotations, selectedCategoryId, selectedAnnotatorIds]);

  const sampleCount =
    filteredUnreviewedCount !== null
      ? Math.max(1, Math.round((filteredUnreviewedCount * samplePercent) / 100))
      : null;

  // Load categories and all annotations on mount
  useEffect(() => {
    let mounted = true;
    async function loadData() {
      setLoading(true);
      setLoadStatus(INITIAL_LOAD_STATUS);
      try {
        const catsPromise = fetchAllPaginatedResults(
          client.models.Category.categoriesByAnnotationSetId,
          {
            annotationSetId: annotationSet.id,
            selectionSet: ['id', 'name', 'shortcutKey'] as const,
          },
          (count) => {
            if (mounted) setLoadStatus((s) => ({ ...s, categories: count }));
          },
        ).then((r) => {
          if (mounted)
            setLoadStatus((s) => ({
              ...s,
              categories: r.length,
              categoriesDone: true,
            }));
          return r;
        });

        const annotationsPromise = fetchAnnotationsByAnnotationSet(
          client,
          annotationSet.id,
          (count) => {
            if (mounted) setLoadStatus((s) => ({ ...s, annotations: count }));
          },
        ).then((r) => {
          if (mounted)
            setLoadStatus((s) => ({
              ...s,
              annotations: r.length,
              annotationsDone: true,
            }));
          return r;
        });

        const [cats, annotations] = await Promise.all([
          catsPromise,
          annotationsPromise,
        ]);
        if (!mounted) return;
        setCategories(
          cats.map((c) => ({
            id: c.id,
            name: c.name,
            shortcutKey: (c as any).shortcutKey ?? null,
          })),
        );
        setAllAnnotations(annotations);
      } catch (err) {
        console.error('Failed to load QC review data', err);
      }
      if (mounted) setLoading(false);
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, [client, annotationSet.id]);

  // Reset annotator filter when category changes
  useEffect(() => {
    setSelectedAnnotatorIds([]);
  }, [selectedCategoryId]);

  // Enable/disable Launch button
  useEffect(() => {
    const shouldDisable =
      loading ||
      !selectedCategoryId ||
      filteredUnreviewedCount === null ||
      filteredUnreviewedCount === 0 ||
      launching;
    setLaunchDisabled(shouldDisable);
  }, [
    loading,
    selectedCategoryId,
    filteredUnreviewedCount,
    launching,
    setLaunchDisabled,
  ]);

  // Refs for stable launch handler
  const selectedCategoryIdRef = useRef(selectedCategoryId);
  const samplePercentRef = useRef(samplePercent);
  const [jobName, setJobName] = useState('');
  const jobNameRef = useRef(jobName);
  jobNameRef.current = jobName;
  const batchSizeRef = useRef(batchSize);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const selectedAnnotatorIdsRef = useRef(selectedAnnotatorIds);

  useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId;
  }, [selectedCategoryId]);
  useEffect(() => {
    samplePercentRef.current = samplePercent;
  }, [samplePercent]);
  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    selectedAnnotatorIdsRef.current = selectedAnnotatorIds;
  }, [selectedAnnotatorIds]);

  // Expose launch handler to parent
  useEffect(() => {
    setQCLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void,
      ) => {
        const categoryId = selectedCategoryIdRef.current;
        if (!categoryId) {
          onProgress('No category selected.');
          return;
        }

        onLaunchConfirmed();
        onProgress('Launching QC review...');

        const categoryName =
          categories.find((c) => c.id === categoryId)?.name ?? undefined;
        const payload: Record<string, unknown> = {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          categoryId,
          categoryName,
          queueName: jobNameRef.current.trim() || undefined,
          samplePercent: samplePercentRef.current,
          batchSize: batchSizeRef.current,
          hidden: false,
          zoom: zoomRef.current ?? null,
        };
        if (selectedAnnotatorIdsRef.current.length > 0) {
          payload.annotatorUserIds = selectedAnnotatorIdsRef.current;
        }

        onProgress('Submitting QC review request...');
        await sendLaunchQCReviewRequest(client, payload);
        onProgress('QC review launch submitted');

        await logAdminAction(
          client,
          user.userId,
          `Launched QC Review for category "${categoryName ?? categoryId}" in annotation set "${annotationSet.name}" (${samplePercentRef.current}% sample)`,
          project.id,
          (project as any).organizationId,
        ).catch(console.error);
      },
    });
    return () => {
      setQCLaunchHandler(null);
    };
  }, [
    annotationSet.id,
    annotationSet.name,
    categories,
    client,
    project.id,
    project.name,
    setQCLaunchHandler,
    user.userId,
  ]);

  const selectedCategory = availableCategories.find(
    (c) => c.id === selectedCategoryId,
  );

  const nothingLeft = !!selectedCategoryId && filteredUnreviewedCount === 0;
  useLaunchLabel(
    sampleCount ? `Launch ${plural(sampleCount, 'review')}` : null,
    !loading && availableCategories.length === 0
      ? 'There are no annotations to review yet'
      : nothingLeft
        ? 'Nothing left to review for this label'
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
          ]}
        />
      ) : availableCategories.length === 0 ? (
        <Banner tone='warning'>
          This annotation set has no annotations to review yet.
        </Banner>
      ) : (
        <>
          <div>
            <Label className='mb-1'>Label to review</Label>
            <NativeSelect
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              disabled={launching}
            >
              <option value=''>Select a label...</option>
              {availableCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                  {cat.complete ? ' (complete)' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>

          {selectedCategoryId &&
            (nothingLeft ? (
              <Banner tone='info'>
                {selectedAnnotatorIds.length > 0
                  ? 'The selected annotators have no unreviewed annotations for this label.'
                  : `All ${plural(totalCount ?? 0, 'annotation')} for ${selectedCategory?.name} have been reviewed.`}
              </Banner>
            ) : (
              <LaunchSummary value={sampleCount?.toLocaleString() ?? '—'}>
                {sampleCount === 1 ? 'annotation' : 'annotations'} sampled (
                {samplePercent}% of{' '}
                {(filteredUnreviewedCount ?? 0).toLocaleString()} not yet
                reviewed)
                <br />
                {plural(totalCount ?? 0, 'annotation')} of{' '}
                {selectedCategory?.name} in total
                {selectedAnnotatorIds.length > 0 &&
                  `, ${unreviewedCount.toLocaleString()} unreviewed by anyone`}
              </LaunchSummary>
            ))}

          {selectedCategoryId && !nothingLeft && (
            <>
              <div className='grid gap-3 sm:grid-cols-3'>
                <div>
                  <Label className='mb-1'>Sample size</Label>
                  <div className='relative'>
                    <Input
                      type='number'
                      min={1}
                      max={100}
                      step={1}
                      className='pr-8'
                      value={samplePercent}
                      onChange={(e) => setSamplePercent(Number(e.target.value))}
                      disabled={launching}
                    />
                    <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-[#6c757d]'>
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <Label className='mb-1'>Batch size</Label>
                  <Input
                    type='number'
                    title='The number of reviews a user can pick up at a time'
                    value={batchSize}
                    onChange={(e) => setBatchSize(Number(e.target.value))}
                    disabled={launching}
                  />
                </div>
                <ZoomSetting
                  mode='offset'
                  zoom={zoom}
                  onChange={setZoom}
                  loadCandidates={async () =>
                    pickZoomPreviewCandidates(categoryAnnotations)
                  }
                  disabled={launching}
                />
              </div>
            </>
          )}

          <AdvancedOptions disabled={launching}>
            <SettingRow label='Job name' hint='Shown on the Jobs page'>
              <Input
                type='text'
                aria-label='Job name'
                placeholder={selectedCategory?.name || 'QC Review'}
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                disabled={launching}
              />
            </SettingRow>
            {annotatorOptions.length > 1 && (
              <SettingRow
                label='Only review work by'
                hint='Leave all unticked to include everyone.'
              >
                <div className='flex max-h-40 flex-col gap-1.5 overflow-y-auto border border-white/15 bg-white/[0.07] px-3 py-2 text-sm'>
                  {annotatorOptions.map((ownerId) => (
                    <label
                      key={ownerId}
                      className='mb-0 flex items-center gap-2'
                    >
                      <Checkbox
                        checked={selectedAnnotatorIds.includes(ownerId)}
                        disabled={launching}
                        onCheckedChange={(c) =>
                          setSelectedAnnotatorIds((prev) =>
                            c === true
                              ? [...prev, ownerId]
                              : prev.filter((id) => id !== ownerId),
                          )
                        }
                      />
                      {userMap[ownerId] ?? ownerId}
                    </label>
                  ))}
                </div>
              </SettingRow>
            )}
          </AdvancedOptions>
        </>
      )}
    </div>
  );
}

// Fetch all annotations for an annotation set.
// Returns minimal fields needed for counting, filtering, and annotator identification.
async function fetchAnnotationsByAnnotationSet(
  client: DataClient,
  annotationSetId: string,
  onProgress?: (count: number) => void,
): Promise<
  Array<{
    id: string;
    categoryId: string;
    reviewCatId: string | null;
    owner: string | null;
  }>
> {
  const rows = await loadRows(
    client,
    'annotationsByAnnotationSetId',
    annotationSetId,
    ['categoryId', 'reviewCatId', 'owner'],
    { onProgress },
  );
  return rows.flatMap((row) =>
    row.categoryId
      ? [
          {
            id: row.id,
            categoryId: row.categoryId,
            reviewCatId: row.reviewCatId,
            owner: row.owner,
          },
        ]
      : [],
  );
}

// Send the QC review launch request to the Lambda.
async function sendLaunchQCReviewRequest(
  client: DataClient,
  payload: Record<string, unknown>,
) {
  const requestPayload = JSON.stringify(payload);

  try {
    await (client as any).mutations.launchQCReview(
      {
        request: requestPayload,
      },
      { retry: false },
    );
  } catch (error: any) {
    // Ignore timeout errors - the Lambda may still be processing.
    if (shouldIgnoreLaunchError(error)) {
      console.warn('Ignoring launch lambda timeout response', error);
      return;
    }
    throw error;
  }
}

export function shouldIgnoreLaunchError(error: any): boolean {
  const messages: string[] = [];
  if (error?.message) messages.push(String(error.message));
  if (Array.isArray(error?.errors)) {
    for (const err of error.errors) {
      if (err?.message) messages.push(String(err.message));
    }
  }
  return messages.some((msg) =>
    /timed out|timeout|Task timed out|socket hang up/i.test(msg),
  );
}
