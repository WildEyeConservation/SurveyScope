import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Form } from 'react-bootstrap';
import { LoadingProgressCard } from './LoadingProgressCard';
import { uploadData } from 'aws-amplify/storage';
import { Schema } from '../amplify/client-schema';
import { useSession } from '../session';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';
import { DataClient } from '../../amplify/shared/data-schema.generated';
import { logAdminAction } from '../utils/adminActionLogger';
import type {
  AnnotationType,
  ImageNeighbourType,
  ImageType,
} from '../schemaTypes';
import { findIncompleteTransectIds } from '../individual-id/utils/transectCompletion';

// AppSync rejects very large mutation arguments; above this the payload is
// staged in S3 and only a reference is sent (mirrors FalseNegatives).
const PAYLOAD_SIZE_THRESHOLD = 200_000;

type LaunchHandler = {
  execute: (
    onProgress: (msg: string) => void,
    onLaunchConfirmed: () => void
  ) => Promise<void>;
};

type CategoryOption = { id: string; name: string };

// Per-query load progress so the user sees each parallel fetch advance
// independently rather than a single opaque "Loading annotations".
type LoadStatus = {
  categories: number;
  categoriesDone: boolean;
  annotations: number;
  annotationsDone: boolean;
  images: number;
  imagesDone: boolean;
};

const INITIAL_LOAD_STATUS: LoadStatus = {
  categories: 0,
  categoriesDone: false,
  annotations: 0,
  annotationsDone: false,
  images: 0,
  imagesDone: false,
};

type AnnotationRow = {
  id: string;
  categoryId: string;
  imageId: string;
  x: number;
  y: number;
  objectId: string | null;
  oov: boolean | null;
};

// timestamp/originalPath drive the reunion search's chronological endpoint
// ordering — without them every image falls back to id order and the
// launch-time check could disagree with the harness.
type ImageWithNeighbours = Pick<
  ImageType,
  'id' | 'width' | 'height' | 'transectId' | 'timestamp' | 'originalPath'
> & {
  leftNeighbours?: ImageNeighbourType[] | null;
  rightNeighbours?: ImageNeighbourType[] | null;
};

export default function IndividualId({
  project,
  annotationSet,
  launching,
  setLaunchDisabled,
  setIndividualIdLaunchHandler,
}: {
  project: Schema['Project']['type'];
  annotationSet: Schema['AnnotationSet']['type'];
  launching: boolean;
  setLaunchDisabled: React.Dispatch<React.SetStateAction<boolean>>;
  setIndividualIdLaunchHandler: React.Dispatch<
    React.SetStateAction<LaunchHandler | null>
  >;
}) {
  const { user } = useSession();

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [allAnnotations, setAllAnnotations] = useState<AnnotationRow[]>([]);
  const [projectImages, setProjectImages] = useState<ImageWithNeighbours[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>(
    INITIAL_LOAD_STATUS
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  // Transects (for the selected label) that still have linking work, computed
  // with the same Munkres/completion logic the harness uses. `null` until
  // computed or when the project has no transects yet (nothing could be
  // complete, so the gate doesn't apply and the lambda detects transects).
  const [incompleteTransectIds, setIncompleteTransectIds] = useState<
    string[] | null
  >(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Categories that actually have annotations, with per-category image counts.
  const availableCategories = useMemo(() => {
    const byCat = new Map<string, Set<string>>();
    for (const a of allAnnotations) {
      let set = byCat.get(a.categoryId);
      if (!set) {
        set = new Set();
        byCat.set(a.categoryId, set);
      }
      set.add(a.imageId);
    }
    return categories
      .filter((c) => byCat.has(c.id))
      .map((c) => ({ ...c, imageCount: byCat.get(c.id)!.size }));
  }, [categories, allAnnotations]);

  const selectedImageIds = useMemo(() => {
    if (!selectedCategoryId) return [];
    const ids = new Set<string>();
    for (const a of allAnnotations) {
      if (a.categoryId === selectedCategoryId) ids.add(a.imageId);
    }
    return Array.from(ids);
  }, [allAnnotations, selectedCategoryId]);

  // Project images keyed by id, plus the transect grouping and the de-duped,
  // skip-filtered neighbour list — the inputs the harness's completion logic
  // needs. Derived once from the project image load; category-independent.
  const { imagesById, imageIdsByTransect, rawNeighbours } = useMemo(() => {
    const byId: Record<string, ImageType> = {};
    const byTransect = new Map<string, Set<string>>();
    for (const img of projectImages) {
      byId[img.id] = img as unknown as ImageType;
      if (img.transectId) {
        let set = byTransect.get(img.transectId);
        if (!set) {
          set = new Set<string>();
          byTransect.set(img.transectId, set);
        }
        set.add(img.id);
      }
    }
    const seen = new Set<string>();
    const neighbours: ImageNeighbourType[] = [];
    for (const img of projectImages) {
      for (const n of [
        ...(img.leftNeighbours ?? []),
        ...(img.rightNeighbours ?? []),
      ]) {
        if (n.skipped) continue;
        if (!byId[n.image1Id] || !byId[n.image2Id]) continue;
        const k = `${n.image1Id}__${n.image2Id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        neighbours.push(n);
      }
    }
    return {
      imagesById: byId,
      imageIdsByTransect: byTransect,
      rawNeighbours: neighbours,
    };
  }, [projectImages]);

  // Transects only exist once a prior workflow (or a previous Individual ID
  // launch) has created them. Without them no individual-id linking can have
  // happened, so the "already complete" gate doesn't apply — the launch
  // lambda detects and creates transects itself.
  const transectsExist = imageIdsByTransect.size > 0;

  // Recompute which transects still have work whenever the label changes.
  // Deferred to a macrotask so the "Checking…" status can paint before the
  // (potentially heavy) Munkres sweep blocks the thread.
  useEffect(() => {
    if (loading || !selectedCategoryId) {
      setIncompleteTransectIds(null);
      setAnalyzing(false);
      return;
    }
    if (!transectsExist) {
      setIncompleteTransectIds(null);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // Deliberately unfiltered by category: direct-pair evaluation filters
      // internally, and the reunion search needs every annotation so chain
      // membership matches what the harness sees at runtime.
      const annotationsByImage: Record<string, AnnotationType[]> = {};
      for (const a of allAnnotations) {
        (annotationsByImage[a.imageId] ??= []).push(
          a as unknown as AnnotationType
        );
      }
      const ids = findIncompleteTransectIds({
        imagesById,
        imageIdsByTransect,
        rawNeighbours,
        annotationsByImage,
        categoryId: selectedCategoryId,
      });
      if (cancelled) return;
      setIncompleteTransectIds(ids);
      setAnalyzing(false);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    loading,
    selectedCategoryId,
    transectsExist,
    allAnnotations,
    imagesById,
    imageIdsByTransect,
    rawNeighbours,
  ]);

  // No transect has outstanding work for this label — launching would create
  // a job whose every transect is already done.
  const noWork =
    transectsExist &&
    !analyzing &&
    incompleteTransectIds !== null &&
    incompleteTransectIds.length === 0;

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
            selectionSet: ['id', 'name'] as const,
          },
          (count) => {
            if (mounted)
              setLoadStatus((s) => ({ ...s, categories: count }));
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

        const annotationsPromise = fetchSetAnnotations(
          client,
          annotationSet.id,
          (count) => {
            if (mounted)
              setLoadStatus((s) => ({ ...s, annotations: count }));
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

        const imagesPromise = fetchProjectImages(
          client,
          project.id,
          (count) => {
            if (mounted) setLoadStatus((s) => ({ ...s, images: count }));
          }
        ).then((r) => {
          if (mounted)
            setLoadStatus((s) => ({
              ...s,
              images: r.length,
              imagesDone: true,
            }));
          return r;
        });

        const [cats, annotations, images] = await Promise.all([
          catsPromise,
          annotationsPromise,
          imagesPromise,
        ]);
        if (!mounted) return;
        setCategories(cats.map((c) => ({ id: c.id, name: c.name })));
        setAllAnnotations(annotations);
        setProjectImages(images);
      } catch (err) {
        console.error('Failed to load Individual ID data', err);
      }
      if (mounted) setLoading(false);
    }
    loadData();
    return () => {
      mounted = false;
    };
  }, [annotationSet.id, project.id]);

  useEffect(() => {
    setLaunchDisabled(
      loading || analyzing || !selectedCategoryId || launching || noWork
    );
  }, [
    loading,
    analyzing,
    selectedCategoryId,
    launching,
    noWork,
    setLaunchDisabled,
  ]);

  const selectedCategoryIdRef = useRef(selectedCategoryId);
  const selectedImageIdsRef = useRef(selectedImageIds);
  const transectsExistRef = useRef(transectsExist);
  const incompleteTransectIdsRef = useRef(incompleteTransectIds);
  useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId;
  }, [selectedCategoryId]);
  useEffect(() => {
    selectedImageIdsRef.current = selectedImageIds;
  }, [selectedImageIds]);
  useEffect(() => {
    transectsExistRef.current = transectsExist;
  }, [transectsExist]);
  useEffect(() => {
    incompleteTransectIdsRef.current = incompleteTransectIds;
  }, [incompleteTransectIds]);

  useEffect(() => {
    setIndividualIdLaunchHandler({
      execute: async (
        onProgress: (msg: string) => void,
        onLaunchConfirmed: () => void
      ) => {
        const categoryId = selectedCategoryIdRef.current;
        if (!categoryId) {
          onProgress('No label selected.');
          return;
        }

        // Only launch transects that still have linking work. When transects
        // already exist we send the explicit incomplete set so the lambda
        // skips already-finished ones; if none remain, abort before launching.
        const transectsExist = transectsExistRef.current;
        const incomplete = incompleteTransectIdsRef.current;
        if (transectsExist && incomplete !== null && incomplete.length === 0) {
          onProgress(
            'All transects for this label are already complete — nothing to launch.'
          );
          return;
        }

        onLaunchConfirmed();
        onProgress('Launching ChainLinker...');

        const categoryName =
          categories.find((c) => c.id === categoryId)?.name ?? undefined;
        const payload: Record<string, unknown> = {
          projectId: project.id,
          annotationSetId: annotationSet.id,
          categoryId,
          categoryName,
          annotatedImageIds: selectedImageIdsRef.current,
        };
        // Omitted when transects don't exist yet: the lambda detects/creates
        // them, and a fresh project has no completed work to skip.
        if (transectsExist && incomplete && incomplete.length > 0) {
          payload.incompleteTransectIds = incomplete;
        }

        onProgress('Submitting ChainLinker request...');
        await sendLaunchIndividualIdRequest(client, payload);
        onProgress('ChainLinker launch submitted');

        await logAdminAction(
          client,
          user.userId,
          `Launched ChainLinker for label "${categoryName ?? categoryId}" in annotation set "${annotationSet.name}"`,
          project.id,
          (project as any).organizationId
        ).catch(console.error);
      },
    });
    return () => {
      setIndividualIdLaunchHandler(null);
    };
  }, [
    annotationSet.id,
    annotationSet.name,
    categories,
    project.id,
    setIndividualIdLaunchHandler,
    user.userId,
  ]);

  const selectedCategory = availableCategories.find(
    (c) => c.id === selectedCategoryId
  );

  return (
    <div className='px-3 pb-3 pt-1'>
      <div className='d-flex flex-column gap-3 mt-2'>
        {loading ? (
          <LoadingProgressCard
            title='Loading ChainLinker data…'
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
                label: 'Images & neighbours',
                count: loadStatus.images,
                done: loadStatus.imagesDone,
              },
            ]}
          />
        ) : availableCategories.length === 0 ? (
          <Alert variant='warning' className='mb-0'>
            No labels with annotations found for this annotation set.
          </Alert>
        ) : (
          <>
            <Form.Group>
              <Form.Label className='mb-0'>Label to identify</Form.Label>
              <span
                className='text-muted d-block mb-1'
                style={{ fontSize: '12px' }}
              >
                Select the label whose individuals should be identified across
                images.
              </span>
              <Form.Select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                disabled={launching}
              >
                <option value=''>Select a label...</option>
                {availableCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            {selectedCategoryId && selectedCategory && (
              <div
                className='border border-dark shadow-sm p-2'
                style={{ backgroundColor: '#697582' }}
              >
                <div className='text-white' style={{ fontSize: '12px' }}>
                  <div>
                    Images with <strong>{selectedCategory.name}</strong>{' '}
                    annotations: <strong>{selectedCategory.imageCount}</strong>
                  </div>
                  {analyzing ? (
                    <div className='text-muted mt-1'>
                      Checking which transects still need identification…
                    </div>
                  ) : transectsExist && incompleteTransectIds !== null ? (
                    <div className='text-muted mt-1'>
                      Transects with outstanding work:{' '}
                      <strong>{incompleteTransectIds.length}</strong>
                    </div>
                  ) : (
                    <div className='text-muted mt-1'>
                      Transects containing these images will be made available
                      as ChainLinker jobs once tiling completes.
                    </div>
                  )}
                </div>
              </div>
            )}

            {noWork && (
              <Alert variant='warning' className='mb-0'>
                Every transect with <strong>{selectedCategory?.name}</strong>{' '}
                annotations has already been fully identified
              </Alert>
            )}
          </>
        )}
      </div>
    </div>
  );
}

async function fetchSetAnnotations(
  client: DataClient,
  annotationSetId: string,
  onProgress?: (count: number) => void
): Promise<AnnotationRow[]> {
  const allItems: AnnotationRow[] = [];
  let nextToken: string | null | undefined = undefined;
  let lastReported = 0;

  do {
    const { data, nextToken: nt } =
      await client.models.Annotation.annotationsByAnnotationSetId(
        { setId: annotationSetId },
        {
          selectionSet: [
            'id',
            'categoryId',
            'imageId',
            'x',
            'y',
            'objectId',
            'oov',
          ] as const,
          limit: 10000,
          nextToken,
        }
      );
    for (const item of data || []) {
      allItems.push({
        id: item.id,
        categoryId: item.categoryId,
        imageId: item.imageId,
        x: item.x,
        y: item.y,
        objectId: (item as { objectId?: string | null }).objectId ?? null,
        oov: (item as { oov?: boolean | null }).oov ?? null,
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

// Project images plus their neighbour edges, mirroring useTransectData's
// selection set but project-wide (the modal can't scope to one transect yet).
async function fetchProjectImages(
  client: DataClient,
  projectId: string,
  onProgress?: (count: number) => void
): Promise<ImageWithNeighbours[]> {
  const images = await fetchAllPaginatedResults<ImageWithNeighbours>(
    client.models.Image.imagesByProjectId,
    {
      projectId,
      limit: 10000,
      selectionSet: [
        'id',
        'width',
        'height',
        'transectId',
        'timestamp',
        'originalPath',
        'leftNeighbours.*',
        'rightNeighbours.*',
      ],
    },
    onProgress
  );
  return images;
}

async function sendLaunchIndividualIdRequest(
  client: DataClient,
  payload: Record<string, unknown>
) {
  const payloadStr = JSON.stringify(payload);
  let requestPayload: string;

  if (payloadStr.length > PAYLOAD_SIZE_THRESHOLD) {
    const s3Key = `launch-payloads/${crypto.randomUUID()}.json`;
    await uploadData({
      path: s3Key,
      data: payloadStr,
      options: { bucket: 'outputs', contentType: 'application/json' },
    }).result;
    requestPayload = JSON.stringify({ payloadS3Key: s3Key });
  } else {
    requestPayload = payloadStr;
  }

  try {
    await (client as any).mutations.launchIndividualId(
      { request: requestPayload },
      { retry: false }
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
    /timed out|timeout|Task timed out|socket hang up/i.test(msg)
  );
}
