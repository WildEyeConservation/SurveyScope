import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import Select from 'react-select';
import { LoadingProgressCard } from './LoadingProgressCard';
import { uploadData } from 'aws-amplify/storage';
import { Schema } from '../amplify/client-schema';
import { UserContext } from '../Context';
import { client } from '../stores/appClient';
import { logAdminAction } from '../utils/adminActionLogger';
import { fetchAllPaginatedResults } from '../utils';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import pLimit from 'p-limit';

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void
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
  includeSkipped: boolean
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

      if (!annotatedImageIds.has(imageId) && !annotatedImageIds.has(otherId)) continue;

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
  const { user } = useContext(UserContext)!;

  // ── Up-front data loading state ──
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(
    INITIAL_LOAD_STATUS
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Cached data (populated once on mount) ──
  const [allAnnotations, setAllAnnotations] = useState<AnnotationItem[]>([]);
  const neighbourCacheRef = useRef(new Map<string, NeighbourItem[]>());
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);

  // ── User options ──
  const [selectedCategories, setSelectedCategories] = useState<CategoryOption[]>([]);
  const [batchSize, setBatchSize] = useState<number>(50);
  const [hidden, setHidden] = useState(false);
  const [includeSkipped, setIncludeSkipped] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [queueName, setQueueName] = useState<string>(`Homography - ${annotationSet.name}`);

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
        const annotations = await fetchAllPaginatedResults<AnnotationItem>(
          (client.models.Annotation as any).annotationsByAnnotationSetId,
          {
            setId: annotationSet.id,
            limit: 10000,
            selectionSet: ['id', 'imageId', 'categoryId'] as const,
          },
          (count) => {
            if (!cancelled)
              setLoadStatus((s) => ({ ...s, annotations: count }));
          }
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

        // 4. Fetch neighbours for all annotated images
        const totalImages = annotatedImageIds.size;
        const neighbourCache = neighbourCacheRef.current;
        const uncachedImageIds = [...annotatedImageIds].filter((id) => !neighbourCache.has(id));
        const cachedCount = totalImages - uncachedImageIds.length;
        setLoadStatus((s) => ({ ...s, neighbours: cachedCount }));

        if (uncachedImageIds.length > 0) {
          const limit = pLimit(15);
          let completed = 0;

          await Promise.all(
            uncachedImageIds.map((imageId) =>
              limit(async () => {
                const [n1, n2] = await Promise.all([
                  fetchAllPaginatedResults<NeighbourItem>(
                    (client.models.ImageNeighbour as any).imageNeighboursByImage1key,
                    { image1Id: imageId, limit: 10000, selectionSet: NEIGHBOUR_SELECTION }
                  ),
                  fetchAllPaginatedResults<NeighbourItem>(
                    (client.models.ImageNeighbour as any).imageNeighboursByImage2key,
                    { image2Id: imageId, limit: 10000, selectionSet: NEIGHBOUR_SELECTION }
                  ),
                ]);
                neighbourCache.set(imageId, [...n1, ...n2]);
                completed++;
                if (completed % 50 === 0 || completed === uncachedImageIds.length) {
                  if (!cancelled) {
                    setLoadStatus((s) => ({
                      ...s,
                      neighbours: cachedCount + completed,
                    }));
                  }
                }
              })
            )
          );
        }

        if (cancelled) return;
        setLoadStatus((s) => ({
          ...s,
          neighbours: totalImages,
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
    return () => { cancelled = true; };
  }, [project.id, annotationSet.id]);

  // ── Enrich category options with completion status ──
  const enrichedCategoryOptions = useMemo(() => {
    if (loading) return categoryOptions;
    return categoryOptions
      .filter((opt) => allAnnotations.some((a) => a.categoryId === opt.value))
      .map((opt) => {
        const catAnnotations = allAnnotations.filter((a) => a.categoryId === opt.value);
        const { pairs } = calculatePairs(catAnnotations, neighbourCacheRef.current, false);
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
    const { pairs } = calculatePairs(effectiveAnnotations, neighbourCacheRef.current, includeSkipped);
    return pairs.size;
  }, [loading, effectiveAnnotations, includeSkipped]);

  // ── Enable/disable Launch button ──
  useEffect(() => {
    setLaunchDisabled(loading || launching || pairCount === 0 || pairCount === null);
  }, [loading, launching, pairCount, setLaunchDisabled]);

  // ── Refs for stable launch handler ──
  const batchSizeRef = useRef(batchSize);
  const hiddenRef = useRef(hidden);
  const queueNameRef = useRef(queueName);
  const includeSkippedRef = useRef(includeSkipped);
  const effectiveAnnotationsRef = useRef(effectiveAnnotations);

  useEffect(() => { batchSizeRef.current = batchSize; }, [batchSize]);
  useEffect(() => { hiddenRef.current = hidden; }, [hidden]);
  useEffect(() => { queueNameRef.current = queueName; }, [queueName]);
  useEffect(() => { includeSkippedRef.current = includeSkipped; }, [includeSkipped]);
  useEffect(() => { effectiveAnnotationsRef.current = effectiveAnnotations; }, [effectiveAnnotations]);

  // ── Expose launch handler to parent ──
  useEffect(() => {
    setHomographyLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void
      ) => {
        const neighbourCache = neighbourCacheRef.current;
        const annotations = effectiveAnnotationsRef.current;

        const { pairs } = calculatePairs(
          annotations, neighbourCache, includeSkippedRef.current
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
        onProgress(`Fetching metadata for ${allInvolvedImageIds.size} images...`);

        // Fetch image metadata (not cached during preview — only needed at launch)
        const imageMetaMap = await fetchImageMetadata(
          client, [...allInvolvedImageIds], onProgress
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

        // Upload manifest to S3
        const manifestKey = `queue-manifests/${crypto.randomUUID()}.json`;
        await uploadData({
          path: manifestKey,
          data: JSON.stringify({ items: manifestItems }),
          options: {
            bucket: 'outputs',
            contentType: 'application/json',
          },
        }).result;

        // Call lambda with manifest reference
        onProgress('Submitting homography launch request...');
        const payload = {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          batchSize: batchSizeRef.current,
          hidden: hiddenRef.current,
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
          (project as any).organizationId
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
    project.id,
    selectedCategories.length,
    setHomographyLaunchHandler,
    user.userId,
  ]);

  // ── Render ──

  if (loadError) {
    return (
      <div className='px-3 pb-3 pt-1'>
        <span className='text-danger'>Failed to load: {loadError}</span>
      </div>
    );
  }

  return (
    <div className='px-3 pb-3'>
      <div className='d-flex flex-column gap-3 pt-2'>
        {/* Progress / pair count */}
        {loading ? (
          <LoadingProgressCard
            title='Loading homography data…'
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
                label: 'Image neighbours',
                count: loadStatus.neighbours,
                done: loadStatus.neighboursDone,
              },
            ]}
          />
        ) : pairCount !== null ? (
          <div className='d-flex align-items-center gap-2'>
            <span style={{ fontSize: '14px' }}>
              {pairCount === 0 ? (
                <span className='text-warning'>No pairs requiring homography found.</span>
              ) : (
                <>
                  <strong>{pairCount.toLocaleString()}</strong>{' '}
                  pair{pairCount !== 1 ? 's' : ''} to launch
                  {selectedCategories.length > 0 && (
                    <span className='text-muted'>
                      {' '}(filtered to {selectedCategories.length} label{selectedCategories.length !== 1 ? 's' : ''})
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        ) : null}

        {/* Label filter (only after loading) */}
        {!loading && (
          <>
            <Form.Group>
              <Form.Label className='mb-0'>Filter by Labels</Form.Label>
              <span
                className='text-muted d-block mb-1'
                style={{ fontSize: '12px' }}
              >
                By default all labels are included. Select specific labels to
                narrow which annotations define image pairs.
              </span>
              <Select
                value={selectedCategories}
                onChange={(v) => setSelectedCategories(v as CategoryOption[])}
                isMulti
                name='Labels for homography'
                options={enrichedCategoryOptions}
                className='text-black w-100'
                closeMenuOnSelect={false}
                isDisabled={launching}
                placeholder='All labels (default)'
              />
              {selectedCategories.length > 0 && (
                <span
                  className='text-warning d-block mt-1'
                  style={{ fontSize: '12px' }}
                >
                  Note: After homographies are created, all labels affected by the
                  new homographies will be updated, not just the ones in this filter.
                </span>
              )}
            </Form.Group>

            <Form.Group>
              <Form.Switch
                label='Show Advanced Options'
                checked={showAdvancedOptions}
                onChange={() => setShowAdvancedOptions(!showAdvancedOptions)}
                disabled={launching}
              />
            </Form.Group>

            {showAdvancedOptions && (
              <div
                className='d-flex flex-column gap-3 border border-dark shadow-sm p-2'
                style={{ backgroundColor: '#697582' }}
              >
                <Form.Group>
                  <Form.Label className='mb-0'>Job Name</Form.Label>
                  <span
                    className='text-muted d-block mb-1'
                    style={{ fontSize: '12px' }}
                  >
                    The name shown on the Jobs page.
                  </span>
                  <Form.Control
                    type='text'
                    value={queueName}
                    onChange={(e) => setQueueName(e.target.value)}
                    disabled={launching}
                  />
                </Form.Group>

                <Form.Group>
                  <Form.Label className='mb-0'>Batch Size</Form.Label>
                  <span
                    className='text-muted d-block mb-1'
                    style={{ fontSize: '12px' }}
                  >
                    The number of pairs a user can pick up at a time.
                  </span>
                  <Form.Control
                    type='number'
                    value={batchSize}
                    onChange={(e) =>
                      setBatchSize(
                        Number((e.target as HTMLInputElement).value)
                      )
                    }
                    disabled={launching}
                  />
                </Form.Group>

                <Form.Group>
                  <Form.Switch
                    label='Hide Job From Non-Admin Workers'
                    checked={hidden}
                    onChange={() => setHidden(!hidden)}
                    disabled={launching}
                  />
                  <span
                    className='text-muted d-block'
                    style={{ fontSize: '12px' }}
                  >
                    When enabled, only admin users will see this job on the Jobs
                    page.
                  </span>
                </Form.Group>

                <Form.Group>
                  <Form.Switch
                    label='Include Previously Skipped Pairs'
                    checked={includeSkipped}
                    onChange={() => setIncludeSkipped(!includeSkipped)}
                    disabled={launching}
                  />
                  <span
                    className='text-muted d-block'
                    style={{ fontSize: '12px' }}
                  >
                    When enabled, pairs that were previously skipped will be
                    included for review.
                  </span>
                </Form.Group>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Data fetching helpers ──

const NEIGHBOUR_SELECTION = ['image1Id', 'image2Id', 'homography', 'skipped'] as const;

const IMAGE_SELECTION = [
  'id', 'width', 'height', 'timestamp', 'originalPath', 'projectId',
  'latitude', 'longitude', 'altitude_wgs84', 'cameraSerial', 'group',
] as const;

async function fetchImageMetadata(
  client: DataClient,
  imageIds: string[],
  onProgress: (msg: string) => void
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
            { selectionSet: IMAGE_SELECTION }
          );
          if (data) result.set(id, data as unknown as HomographyImageMeta);
        } catch (err) {
          console.warn('Failed to fetch image metadata', { id, error: err });
        }
        completed++;
        if (completed % 100 === 0 || completed === imageIds.length) {
          onProgress(`Fetched metadata for ${completed}/${imageIds.length} images...`);
        }
      })
    )
  );

  return result;
}

// ── Lambda communication ──

async function sendLaunchRequest(
  client: DataClient,
  payload: Record<string, unknown>
) {
  const requestPayload = JSON.stringify(payload);
  try {
    await (client as any).mutations.launchHomography({ request: requestPayload }, { retry: false });
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
    /timed out|timeout|Task timed out|socket hang up/i.test(msg)
  );
}
