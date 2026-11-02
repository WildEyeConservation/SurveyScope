import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import pLimit from 'p-limit';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { Schema } from '../amplify/client-schema';
import { GlobalContext, UserContext } from '../Context';
import { loadRows } from '../rowChunks';
import { uploadWorkflowFile } from '../storage/workflowFiles';
import { logAdminAction } from '../utils/adminActionLogger';
import { plural, useLaunchLabel } from './launchLabel';
import {
  AdvancedOptions,
  Banner,
  LaunchSummary,
  SettingRow,
  SwitchRow,
} from './launchParts';
import { LoadingProgressCard } from './LoadingProgressCard';

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void,
  ) => Promise<void>;
};

type CategoryOption = { label: string; value: string };

type AnnotationItem = { id: string; imageId: string; categoryId: string };

type NeighbourItem = {
  image1Id: string;
  image2Id: string;
  homography: number[] | null;
  skipped: boolean | null;
};

type HomographyImageMeta = {
  id: string;
  width: number;
  height: number;
  timestamp: number | null;
  originalPath: string | null;
  projectId: string;
  latitude: number | null;
  longitude: number | null;
  altitude_wgs84: number | null;
  cameraSerial: string | null;
  group: string | null;
};

type HomographyPairManifestItem = {
  pairKey: string;
  image1Id: string;
  image2Id: string;
  annotationSetId: string;
  primaryImage: HomographyImageMeta;
  secondaryImage: HomographyImageMeta;
};

type PairInfo = { primaryId: string; secondaryId: string };

// Per-query load progress so each fetch (labels → annotations → neighbours)
// shows its own live count rather than one opaque status line.
type LoadStatus = {
  categories: number;
  categoriesDone: boolean;
  annotations: number;
  annotationsDone: boolean;
  neighbours: number;
  neighboursDone: boolean;
};

const INITIAL_LOAD_STATUS: LoadStatus = {
  categories: 0,
  categoriesDone: false,
  annotations: 0,
  annotationsDone: false,
  neighbours: 0,
  neighboursDone: false,
};

// ── Pair calculation (pure computation, works from cached data) ──

function calculatePairs(
  annotations: AnnotationItem[],
  neighbourCache: Map<string, NeighbourItem[]>,
  includeSkipped: boolean,
): { pairs: Map<string, PairInfo>; annotatedImageIds: Set<string> } {
  const annotatedImageIds = new Set<string>();
  for (const a of annotations) annotatedImageIds.add(a.imageId);

  const pairs = new Map<string, PairInfo>();

  for (const imageId of annotatedImageIds) {
    const neighbours = neighbourCache.get(imageId);
    if (!neighbours) continue;

    for (const nb of neighbours) {
      const otherId = nb.image1Id === imageId ? nb.image2Id : nb.image1Id;
      const pairKey = [imageId, otherId].sort().join('::');
      if (pairs.has(pairKey)) continue;

      const noHomography = !nb.homography || nb.homography.length !== 9;
      if (!noHomography || (nb.skipped && !includeSkipped)) continue;

      if (!annotatedImageIds.has(imageId) && !annotatedImageIds.has(otherId))
        continue;

      const primaryId = annotatedImageIds.has(imageId) ? imageId : otherId;
      const secondaryId = primaryId === imageId ? otherId : imageId;
      pairs.set(pairKey, { primaryId, secondaryId });
    }
  }

  return { pairs, annotatedImageIds };
}

export default function HomographyLaunch({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setHomographyLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
  setHomographyLaunchHandler: React.Dispatch<
    React.SetStateAction<LaunchHandler | null>
  >;
}) {
  const { client } = useContext(GlobalContext)!;
  const { user } = useContext(UserContext)!;

  // ── Up-front data loading state ──
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(INITIAL_LOAD_STATUS);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Cached data (populated once on mount) ──
  const [allAnnotations, setAllAnnotations] = useState<AnnotationItem[]>([]);
  const neighbourCacheRef = useRef(new Map<string, NeighbourItem[]>());
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);

  // ── User options ──
  const [selectedCategories, setSelectedCategories] = useState<
    CategoryOption[]
  >([]);
  const [batchSize, setBatchSize] = useState<number>(50);
  const [includeSkipped, setIncludeSkipped] = useState(false);
  const [queueName, setQueueName] = useState<string>(
    `Homography - ${annotationSet.name}`,
  );

  // ── Up-front fetch: categories + all annotations + neighbours ──
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      try {
        // 1. Fetch categories for this annotation set
        const allCategories: Schema['Category']['type'][] = [];
        let nextToken: string | null | undefined = undefined;
        do {
          const result = await client.models.Category.list({
            filter: { projectId: { eq: project.id } },
            nextToken,
            limit: 10000,
          });
          allCategories.push(...(result.data ?? []));
          nextToken = result.nextToken;
          if (!cancelled)
            setLoadStatus((s) => ({
              ...s,
              categories: allCategories.length,
            }));
        } while (nextToken);

        if (cancelled) return;
        const options = allCategories
          .filter((c) => c.annotationSetId === annotationSet.id)
          .map((c) => ({ label: c.name, value: c.id }));
        setCategoryOptions(options);
        setLoadStatus((s) => ({
          ...s,
          categories: options.length,
          categoriesDone: true,
        }));

        // 2. Fetch ALL annotations for the set (no category filter)
        const rows = await loadRows(
          client,
          'annotationsByAnnotationSetId',
          annotationSet.id,
          ['imageId', 'categoryId'],
          {
            onProgress: (count) => {
              if (!cancelled)
                setLoadStatus((s) => ({ ...s, annotations: count }));
            },
          },
        );
        const annotations = rows.filter(
          (row): row is AnnotationItem => !!row.imageId && !!row.categoryId,
        );
        if (cancelled) return;
        setAllAnnotations(annotations);
        setLoadStatus((s) => ({
          ...s,
          annotations: annotations.length,
          annotationsDone: true,
        }));

        // 3. Determine unique image IDs that have annotations
        const annotatedImageIds = new Set<string>();
        for (const a of annotations) annotatedImageIds.add(a.imageId);

        // 4. Fetch the survey's neighbours in one chunked pass
        const neighbourRows = await loadRows(
          client,
          'imageNeighboursByProjectId',
          project.id,
          ['image1Id', 'image2Id', 'homography', 'skipped'],
          {
            onProgress: (count) => {
              if (!cancelled)
                setLoadStatus((s) => ({ ...s, neighbours: count }));
            },
          },
        );
        const neighbourCache = new Map<string, NeighbourItem[]>();
        for (const id of annotatedImageIds) neighbourCache.set(id, []);
        for (const row of neighbourRows) {
          const item = row as NeighbourItem;
          neighbourCache.get(item.image1Id)?.push(item);
          neighbourCache.get(item.image2Id)?.push(item);
        }
        neighbourCacheRef.current = neighbourCache;

        if (cancelled) return;
        setLoadStatus((s) => ({
          ...s,
          neighbours: neighbourRows.length,
          neighboursDone: true,
        }));
        setLoading(false);
      } catch (err: any) {
        console.error('Failed to load homography data', err);
        if (!cancelled) {
          setLoadError(err?.message ?? 'Failed to load data');
          setLoading(false);
        }
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [client, project.id, annotationSet.id]);

  // ── Enrich category options with completion status ──
  const enrichedCategoryOptions = useMemo(() => {
    if (loading) return categoryOptions;
    return categoryOptions
      .filter((opt) => allAnnotations.some((a) => a.categoryId === opt.value))
      .map((opt) => {
        const catAnnotations = allAnnotations.filter(
          (a) => a.categoryId === opt.value,
        );
        const { pairs } = calculatePairs(
          catAnnotations,
          neighbourCacheRef.current,
          false,
        );
        const complete = pairs.size === 0;
        return {
          ...opt,
          label: complete ? `${opt.label} (complete)` : opt.label,
        };
      });
  }, [loading, categoryOptions, allAnnotations]);

  // ── Compute effective annotations (filtered by selected categories, or all) ──
  const effectiveAnnotations = useMemo(() => {
    if (selectedCategories.length === 0) return allAnnotations;
    const selectedIds = new Set(selectedCategories.map((c) => c.value));
    return allAnnotations.filter((a) => selectedIds.has(a.categoryId));
  }, [allAnnotations, selectedCategories]);

  // ── Calculate pairs from cache (instant, no network) ──
  const pairCount = useMemo(() => {
    if (loading) return null;
    const { pairs } = calculatePairs(
      effectiveAnnotations,
      neighbourCacheRef.current,
      includeSkipped,
    );
    return pairs.size;
  }, [loading, effectiveAnnotations, includeSkipped]);

  // ── Enable/disable Launch button ──
  useEffect(() => {
    setLaunchDisabled(
      loading || launching || pairCount === 0 || pairCount === null,
    );
  }, [loading, launching, pairCount, setLaunchDisabled]);

  // ── Refs for stable launch handler ──
  const batchSizeRef = useRef(batchSize);
  const queueNameRef = useRef(queueName);
  const includeSkippedRef = useRef(includeSkipped);
  const effectiveAnnotationsRef = useRef(effectiveAnnotations);

  useEffect(() => {
    batchSizeRef.current = batchSize;
  }, [batchSize]);
  useEffect(() => {
    queueNameRef.current = queueName;
  }, [queueName]);
  useEffect(() => {
    includeSkippedRef.current = includeSkipped;
  }, [includeSkipped]);
  useEffect(() => {
    effectiveAnnotationsRef.current = effectiveAnnotations;
  }, [effectiveAnnotations]);

  // ── Expose launch handler to parent ──
  useEffect(() => {
    setHomographyLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void,
      ) => {
        const neighbourCache = neighbourCacheRef.current;
        const annotations = effectiveAnnotationsRef.current;

        const { pairs } = calculatePairs(
          annotations,
          neighbourCache,
          includeSkippedRef.current,
        );

        if (pairs.size === 0) {
          alert('No image pairs requiring homography were found.');
          return;
        }

        // Collect all involved image IDs
        const allInvolvedImageIds = new Set<string>();
        for (const { primaryId, secondaryId } of pairs.values()) {
          allInvolvedImageIds.add(primaryId);
          allInvolvedImageIds.add(secondaryId);
        }

        onLaunchConfirmed();
        onProgress(
          `Fetching metadata for ${allInvolvedImageIds.size} images...`,
        );

        // Fetch image metadata (not cached during preview — only needed at launch)
        const imageMetaMap = await fetchImageMetadata(
          client,
          [...allInvolvedImageIds],
          onProgress,
        );

        // Build manifest items
        const manifestItems: HomographyPairManifestItem[] = [];
        for (const [pairKey, { primaryId, secondaryId }] of pairs) {
          const primary = imageMetaMap.get(primaryId);
          const secondary = imageMetaMap.get(secondaryId);
          if (!primary || !secondary) continue;
          manifestItems.push({
            pairKey,
            image1Id: primary.id,
            image2Id: secondary.id,
            annotationSetId: annotationSet.id,
            primaryImage: primary,
            secondaryImage: secondary,
          });
        }

        if (manifestItems.length === 0) {
          alert('No valid image pairs found (missing metadata).');
          return;
        }

        onProgress(`Uploading manifest for ${manifestItems.length} pairs...`);

        const manifestKey = await uploadWorkflowFile(
          'queue-manifest',
          project.id,
          JSON.stringify({ items: manifestItems }),
        );

        // Call lambda with manifest reference
        onProgress('Submitting homography launch request...');
        const payload = {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          batchSize: batchSizeRef.current,
          hidden: false,
          manifestS3Key: manifestKey,
          launchedCount: manifestItems.length,
          queueName: queueNameRef.current,
        };
        await sendLaunchRequest(client, payload);
        onProgress('Homography launch submitted');

        const labelCount = selectedCategories.length || categoryOptions.length;
        await logAdminAction(
          client,
          user.userId,
          `Launched Homography task for ${labelCount} categories, ${manifestItems.length} pairs in annotation set "${annotationSet.name}"`,
          project.id,
          (project as any).organizationId,
        ).catch(console.error);
      },
    });
    return () => {
      setHomographyLaunchHandler(null);
    };
  }, [
    annotationSet.id,
    annotationSet.name,
    categoryOptions.length,
    client,
    project.id,
    selectedCategories.length,
    setHomographyLaunchHandler,
    user.userId,
  ]);

  // ── Render ──
  useLaunchLabel(
    pairCount ? `Launch ${plural(pairCount, 'pair')}` : null,
    loadError
      ? 'The homography data could not be loaded'
      : !loading && pairCount === 0
        ? 'No image pairs need a homography'
        : undefined,
  );

  if (loadError) {
    return (
      <div className='p-4'>
        <Banner tone='danger'>
          The homography data could not be loaded: {loadError}
        </Banner>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4 p-4'>
      {loading ? (
        <LoadingProgressCard
          title='Finding image pairs...'
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
              label: 'Neighbouring image pairs',
              count: loadStatus.neighbours,
              done: loadStatus.neighboursDone,
            },
          ]}
        />
      ) : (
        <>
          {pairCount === 0 ? (
            <Banner tone='info'>
              No image pairs need a homography
              {selectedCategories.length > 0
                ? ' for the selected labels.'
                : '. Every overlapping pair with annotations already has one.'}
            </Banner>
          ) : (
            pairCount !== null && (
              <LaunchSummary value={pairCount.toLocaleString()}>
                image {pairCount === 1 ? 'pair needs' : 'pairs need'} a
                homography
                <br />
                {selectedCategories.length > 0
                  ? `Only pairs with ${plural(selectedCategories.length, 'selected label')}`
                  : 'Pairs with annotations of any label'}
              </LaunchSummary>
            )
          )}
          <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]'>
            <div>
              <Label className='mb-1'>Labels</Label>
              <Combobox
                value={selectedCategories}
                onChange={(options) => setSelectedCategories(options)}
                multiple
                name='Labels for homography'
                options={enrichedCategoryOptions}
                disabled={launching}
                placeholder='All labels'
              />
              {selectedCategories.length > 0 && (
                <span className='mt-1 block text-xs text-muted-foreground'>
                  New homographies update every label they touch, not only
                  these.
                </span>
              )}
            </div>
            <div>
              <Label className='mb-1'>Batch size</Label>
              <Input
                type='number'
                title='The number of pairs a user can pick up at a time'
                value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={launching}
              />
            </div>
          </div>
          <AdvancedOptions disabled={launching}>
            <SettingRow label='Job name' hint='Shown on the Jobs page'>
              <Input
                type='text'
                aria-label='Job name'
                value={queueName}
                onChange={(e) => setQueueName(e.target.value)}
                disabled={launching}
              />
            </SettingRow>
            <SwitchRow
              label='Include pairs that were skipped before'
              checked={includeSkipped}
              onChange={setIncludeSkipped}
              disabled={launching}
            />
          </AdvancedOptions>
        </>
      )}
    </div>
  );
}

// ── Data fetching helpers ──

const IMAGE_SELECTION = [
  'id',
  'width',
  'height',
  'timestamp',
  'originalPath',
  'projectId',
  'latitude',
  'longitude',
  'altitude_wgs84',
  'cameraSerial',
  'group',
] as const;

async function fetchImageMetadata(
  client: DataClient,
  imageIds: string[],
  onProgress: (msg: string) => void,
): Promise<Map<string, HomographyImageMeta>> {
  const result = new Map<string, HomographyImageMeta>();
  const limit = pLimit(15);
  let completed = 0;

  await Promise.all(
    imageIds.map((id) =>
      limit(async () => {
        try {
          const { data } = await client.models.Image.get(
            { id },
            { selectionSet: IMAGE_SELECTION },
          );
          if (data) result.set(id, data as unknown as HomographyImageMeta);
        } catch (err) {
          console.warn('Failed to fetch image metadata', { id, error: err });
        }
        completed++;
        if (completed % 100 === 0 || completed === imageIds.length) {
          onProgress(
            `Fetched metadata for ${completed}/${imageIds.length} images...`,
          );
        }
      }),
    ),
  );

  return result;
}

// ── Lambda communication ──

async function sendLaunchRequest(
  client: DataClient,
  payload: Record<string, unknown>,
) {
  const requestPayload = JSON.stringify(payload);
  try {
    await (client as any).mutations.launchHomography(
      { request: requestPayload },
      { retry: false },
    );
  } catch (error: any) {
    if (shouldIgnoreLaunchError(error)) {
      console.warn('Ignoring launch lambda timeout response', error);
      return;
    }
    throw error;
  }
}

function shouldIgnoreLaunchError(error: any): boolean {
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
