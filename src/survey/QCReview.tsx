import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Form } from 'react-bootstrap';
import { LoadingProgressCard } from './LoadingProgressCard';
import { Schema } from '../amplify/client-schema';
import { useSession } from '../session';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';
import { DataClient } from '../../amplify/shared/data-schema.generated';
import { logAdminAction } from '../utils/adminActionLogger';
import { useUsers } from '../apiInterface';

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void
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
  const { user } = useSession();

  // Data loading
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [allAnnotations, setAllAnnotations] = useState<
    Array<{ id: string; categoryId: string; reviewCatId: string | null; owner: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(
    INITIAL_LOAD_STATUS
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');

  // Launch settings
  const [samplePercent, setSamplePercent] = useState<number>(10);
  const [batchSize, setBatchSize] = useState<number>(200);
  const [hidden, setHidden] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);

  // Annotator filter
  const [selectedAnnotatorIds, setSelectedAnnotatorIds] = useState<string[]>([]);

  const { users } = useUsers();
  const userMap = useMemo(() => {
    return users.reduce((acc, user) => {
      acc[user.id] = user.name ?? user.email ?? user.id;
      return acc;
    }, {} as Record<string, string>);
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
  const unreviewedCount = categoryAnnotations.filter((a) => !a.reviewCatId).length;

  // Distinct annotators who have annotations in the selected category
  const annotatorOptions = useMemo(() => {
    const ownerIds = new Set<string>();
    for (const a of categoryAnnotations) {
      if (a.owner) ownerIds.add(a.owner);
    }
    return Array.from(ownerIds).sort((a, b) =>
      (userMap[a] ?? a).localeCompare(userMap[b] ?? b)
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
          }
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
          }
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
          }))
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
  }, [annotationSet.id]);

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
  const batchSizeRef = useRef(batchSize);
  const hiddenRef = useRef(hidden);
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
    hiddenRef.current = hidden;
  }, [hidden]);
  useEffect(() => {
    selectedAnnotatorIdsRef.current = selectedAnnotatorIds;
  }, [selectedAnnotatorIds]);

  // Expose launch handler to parent
  useEffect(() => {
    setQCLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void
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
          samplePercent: samplePercentRef.current,
          batchSize: batchSizeRef.current,
          hidden: hiddenRef.current,
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
          (project as any).organizationId
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
    project.id,
    project.name,
    setQCLaunchHandler,
    user.userId,
  ]);

  const selectedCategory = availableCategories.find((c) => c.id === selectedCategoryId);

  return (
    <div className='px-3 pb-3 pt-1'>
      <div className='d-flex flex-column gap-3 mt-2'>
        {loading ? (
          <LoadingProgressCard
            title='Loading QC Review data…'
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
          <Alert variant='warning' className='mb-0'>
            No labels with annotations found for this annotation set.
          </Alert>
        ) : (
          <>
            {/* Category selector */}
            <Form.Group>
              <Form.Label className='mb-0'>Label to review</Form.Label>
              <span
                className='text-muted d-block mb-1'
                style={{ fontSize: '12px' }}
              >
                Select the label whose annotations should be reviewed.
              </span>
              <Form.Select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                disabled={launching}
              >
                <option value=''>Select a label...</option>
                {availableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}{cat.complete ? ' (complete)' : ''}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            {/* Annotation count stats */}
            {selectedCategoryId && (
              <div
                className='border border-dark shadow-sm p-2'
                style={{ backgroundColor: '#697582' }}
              >
                <div className='text-white' style={{ fontSize: '12px' }}>
                  <div>
                    Total annotations for{' '}
                    <strong>{selectedCategory?.name}</strong>:{' '}
                    <strong>{totalCount}</strong>
                  </div>
                  <div>
                    Not yet reviewed:{' '}
                    <strong>{unreviewedCount}</strong>
                    {selectedAnnotatorIds.length > 0 &&
                      filteredUnreviewedCount !== unreviewedCount && (
                        <span>
                          {' '}
                          (filtered: <strong>{filteredUnreviewedCount}</strong>)
                        </span>
                      )}
                  </div>
                  {sampleCount !== null && filteredUnreviewedCount !== null && filteredUnreviewedCount > 0 && (
                    <div>
                      Sample size ({samplePercent}%):{' '}
                      <strong>{sampleCount}</strong>
                    </div>
                  )}
                  {filteredUnreviewedCount === 0 && (
                    <div className='mt-1 text-warning'>
                      {selectedAnnotatorIds.length > 0
                        ? 'No unreviewed annotations for the selected annotators.'
                        : 'All annotations for this label have already been reviewed.'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sample percentage */}
            {selectedCategoryId &&
              filteredUnreviewedCount !== null &&
              filteredUnreviewedCount > 0 && (
                <>
                  <Form.Group>
                    <Form.Label className='mb-0'>Sample size (%)</Form.Label>
                    <span
                      className='text-muted d-block mb-1'
                      style={{ fontSize: '12px' }}
                    >
                      Percentage of unreviewed annotations to sample for review.
                    </span>
                    <Form.Control
                      type='number'
                      min={1}
                      max={100}
                      step={1}
                      value={samplePercent}
                      onChange={(e) =>
                        setSamplePercent(
                          Number((e.target as HTMLInputElement).value)
                        )
                      }
                      disabled={launching}
                    />
                  </Form.Group>

                  {/* Advanced options toggle */}
                  <Form.Group>
                    <Form.Switch
                      label='Show Advanced Options'
                      checked={showAdvancedOptions}
                      onChange={() =>
                        setShowAdvancedOptions(!showAdvancedOptions)
                      }
                      disabled={launching}
                    />
                  </Form.Group>

                  {showAdvancedOptions && (
                    <div
                      className='d-flex flex-column gap-3 border border-dark shadow-sm p-2'
                      style={{ backgroundColor: '#697582' }}
                    >
                      <Form.Group>
                        <Form.Label className='mb-0'>Batch Size</Form.Label>
                        <span
                          className='text-muted d-block mb-1'
                          style={{ fontSize: '12px' }}
                        >
                          The number of reviews a user can pick up at a time.
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
                          When enabled, only admin users will see this job on
                          the Jobs page.
                        </span>
                      </Form.Group>

                      {annotatorOptions.length > 1 && (
                        <Form.Group>
                          <Form.Label className='mb-0'>
                            Filter by Annotator
                          </Form.Label>
                          <span
                            className='text-muted d-block mb-1'
                            style={{ fontSize: '12px' }}
                          >
                            Only review annotations made by the selected
                            annotators. Leave all unchecked to include everyone.
                          </span>
                          <div
                            style={{
                              maxHeight: '150px',
                              overflowY: 'auto',
                              backgroundColor: 'rgba(0,0,0,0.15)',
                              borderRadius: '4px',
                              padding: '6px 8px',
                            }}
                          >
                            {annotatorOptions.map((ownerId) => (
                              <Form.Check
                                key={ownerId}
                                type='checkbox'
                                label={userMap[ownerId] ?? ownerId}
                                checked={selectedAnnotatorIds.includes(ownerId)}
                                disabled={launching}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedAnnotatorIds((prev) => [
                                      ...prev,
                                      ownerId,
                                    ]);
                                  } else {
                                    setSelectedAnnotatorIds((prev) =>
                                      prev.filter((id) => id !== ownerId)
                                    );
                                  }
                                }}
                                style={{ fontSize: '13px' }}
                              />
                            ))}
                          </div>
                        </Form.Group>
                      )}
                    </div>
                  )}
                </>
              )}
          </>
        )}
      </div>
    </div>
  );
}

// Fetch all annotations for an annotation set.
// Returns minimal fields needed for counting, filtering, and annotator identification.
async function fetchAnnotationsByAnnotationSet(
  client: DataClient,
  annotationSetId: string,
  onProgress?: (count: number) => void
): Promise<Array<{ id: string; categoryId: string; reviewCatId: string | null; owner: string | null }>> {
  const allItems: Array<{ id: string; categoryId: string; reviewCatId: string | null; owner: string | null }> = [];
  let nextToken: string | null | undefined = undefined;
  let lastReported = 0;

  do {
    const { data, nextToken: nt } =
      await client.models.Annotation.annotationsByAnnotationSetId(
        { setId: annotationSetId },
        {
          selectionSet: ['id', 'categoryId', 'reviewCatId', 'owner'] as const,
          limit: 10000,
          nextToken,
        }
      );
    for (const item of data || []) {
      allItems.push({
        id: item.id,
        categoryId: item.categoryId,
        reviewCatId: (item as any).reviewCatId ?? null,
        owner: (item as any).owner ?? null,
      });
    }
    const currentThousand = Math.floor(allItems.length / 1000);
    if (onProgress && currentThousand > lastReported) {
      lastReported = currentThousand;
      onProgress(allItems.length);
    }
    nextToken = nt as string | null | undefined;
  } while (nextToken);

  return allItems;
}

// Send the QC review launch request to the Lambda.
async function sendLaunchQCReviewRequest(
  client: DataClient,
  payload: Record<string, unknown>
) {
  const requestPayload = JSON.stringify(payload);

  try {
    await (client as any).mutations.launchQCReview({
      request: requestPayload,
    }, { retry: false });
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
    /timed out|timeout|Task timed out|socket hang up/i.test(msg)
  );
}
