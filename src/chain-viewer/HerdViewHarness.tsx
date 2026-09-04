import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Spinner } from 'react-bootstrap';
import Select, { type SingleValue } from 'react-select';
import { client } from '../stores/appClient';
import { fetchAllPaginatedResults } from '../utils';
import type { Lane } from '../individual-id/utils/lanes';
import { buildHerdRuns } from './utils/herdRuns';
import { buildHerdDisplayPairs } from './utils/herdPairs';
import type { CategoryType, ImageType } from '../schemaTypes';
import { useHerdData } from './hooks/useHerdData';
import { HerdMapPair } from './HerdMapPair';
import { HerdNavBar } from './HerdNavBar';
import { ChainTilesModal } from './components/ChainTilesModal';
import ChangeCategoryModal from '../ChangeCategoryModal';
import { useCategories } from '../data/project';
import { useCurrentProject, useProjectId } from '../data/projectScope';
import type { ChainAnnotation } from './types';
import './ChainViewer.css';
import { fetchInfoTagDataForSet, infoTagNamesFor } from '../infoTags';

interface Props {
  annotationSetId: string;
}

type ChainAnnotationRow = {
  id: string;
  x: number;
  y: number;
  imageId: string;
  objectId?: string | null;
  categoryId: string;
  obscured?: boolean | null;
  oov?: boolean | null;
  image?: { timestamp?: number | null } | null;
};

type GraphQLResponse = {
  errors?: { message?: string | null }[] | null;
};

type UpdateAnnotationObscured = (input: {
  id: string;
  obscured: boolean;
}) => Promise<GraphQLResponse>;

type UpdateAnnotationCategory = (input: {
  id: string;
  categoryId: string;
}) => Promise<GraphQLResponse>;

/**
 * Default Chain Viewer content: a stripped-down ChainLinker that walks animal
 * images chronologically within each camera, using registered neighbour pairs
 * to cross between cameras. Two linked maps, lane-aware navigation, a chain-
 * grouped nav bar, and per-marker obscured / view-chain-tiles actions. No
 * matching, linking or auto-pan.
 */
export function HerdViewHarness({ annotationSetId }: Props) {
  const project = useCurrentProject();
  const projectId = useProjectId();
  const { data: categories } = useCategories(projectId);
  const { surveyId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const chainParam = searchParams.get('chain');

  const herd = useHerdData();

  // ---- Bulk fetch all annotations for the set (live, mutable). ----
  const [annotations, setAnnotations] = useState<ChainAnnotation[]>([]);
  const [fetchStatus, setFetchStatus] = useState<
    'idle' | 'loading' | 'done' | 'error'
  >('idle');
  const [fetchCount, setFetchCount] = useState(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFetchStatus('loading');
    setFetchCount(0);
    setFetchError(null);

    (async () => {
      try {
        const data = await fetchAllPaginatedResults(
          client.models.Annotation.annotationsByAnnotationSetId,
          {
            setId: annotationSetId,
            selectionSet: [
              'id',
              'x',
              'y',
              'imageId',
              'objectId',
              'categoryId',
              'obscured',
              'oov',
              'image.timestamp',
            ] as const,
            limit: 10000,
          },
          (steps) => {
            if (!cancelled) setFetchCount(steps);
          }
        );
        if (cancelled) return;
        const infoTagData = await fetchInfoTagDataForSet(
          client,
          annotationSetId
        );
        const tagsDefined = infoTagData.nameById.size > 0;
        if (cancelled) return;
        setAnnotations(
          (data as ChainAnnotationRow[]).map((a) => ({
            id: a.id,
            x: a.x,
            y: a.y,
            imageId: a.imageId,
            objectId: a.objectId ?? null,
            categoryId: a.categoryId,
            obscured: !!a.obscured,
            oov: !!a.oov,
            imageTimestamp:
              typeof a.image?.timestamp === 'number' ? a.image.timestamp : null,
            infoTags: tagsDefined
              ? infoTagNamesFor(infoTagData, a.id)
              : undefined,
          }))
        );
        setFetchStatus('done');
      } catch (err) {
        if (cancelled) return;
        console.error('Herd view annotation fetch failed', err);
        setFetchError(err instanceof Error ? err.message : String(err));
        setFetchStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [annotationSetId]);

  // ---- Category filter ----
  const [selectedCategory, setSelectedCategory] = useState<{
    label: string;
    value: string;
  } | null>(null);

  const setCategories = useMemo(
    () =>
      (categories ?? [])
        .filter((c) => c.annotationSetId === annotationSetId)
        .sort((a, b) => a.name.localeCompare(b.name)) as CategoryType[],
    [categories, annotationSetId]
  );

  const categoryOptions = useMemo(
    () =>
      setCategories
        .map((c) => ({ label: c.name, value: c.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [setCategories]
  );

  const categoryColors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of setCategories) {
      if (c.id && c.color) m[c.id] = c.color;
    }
    return m;
  }, [setCategories]);

  const visibleAnnotations = useMemo(
    () =>
      selectedCategory
        ? annotations.filter((a) => a.categoryId === selectedCategory.value)
        : annotations,
    [annotations, selectedCategory]
  );

  const annotationsByImage = useMemo(() => {
    const out: Record<string, ChainAnnotation[]> = {};
    for (const a of visibleAnnotations) (out[a.imageId] ??= []).push(a);
    return out;
  }, [visibleAnnotations]);

  // ---- Camera-grouped chronological pairs with registered crossovers. ----
  // Same-camera entries need not be database neighbours. Cross-camera entries
  // remain real homography neighbours sharing a chain in both images.
  const { pairs, chainSets } = useMemo(() => {
    const ps = buildHerdDisplayPairs(
      herd.data?.imagesById ?? {},
      herd.data?.rawNeighbours ?? [],
      annotationsByImage
    );
    const cs = ps.map((p) => {
      const aAnns = annotationsByImage[p.image1Id] ?? [];
      const bAnns = annotationsByImage[p.image2Id] ?? [];
      return new Set<string>([
        ...aAnns.map((a) => a.objectId ?? a.id),
        ...bAnns.map((a) => a.objectId ?? a.id),
      ]);
    });
    return { pairs: ps, chainSets: cs };
  }, [
    herd.data?.imagesById,
    herd.data?.rawNeighbours,
    annotationsByImage,
  ]);

  // ---- Single display-order lane + herd-run grouping ----
  // "Herd runs" remain maximal contiguous chain-sharing stretches, now over
  // the camera-grouped traversal rather than globally timestamp-sorted pairs.
  const { runIdByIndex, runStarts } = useMemo(
    () => buildHerdRuns(chainSets, pairs.map((pair) => pair.herdId)),
    [chainSets, pairs]
  );

  const navLane: Lane = useMemo(
    () => ({
      key: 'all',
      kind: 'camera',
      label: '',
      entries: pairs.map((_, i) => i),
      timestamps: pairs.map((p) => p.imageA.timestamp ?? 0),
    }),
    [pairs]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [imageBearings, setImageBearings] = useState<Map<string, number>>(
    () => new Map()
  );
  const initialChainParamHandledRef = useRef<string | null>(null);

  const bearingForImage = useCallback(
    (image: ImageType) => imageBearings.get(image.id) ?? 0,
    [imageBearings]
  );
  const onImageBearingChange = useCallback(
    (image: ImageType, bearing: number) => {
      setImageBearings((current) => {
        if (current.get(image.id) === bearing) return current;
        const next = new Map(current);
        next.set(image.id, bearing);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    if (currentIndex >= pairs.length) setCurrentIndex(0);
  }, [pairs.length, currentIndex]);

  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target >= pairs.length) return;
      setCurrentIndex(target);
    },
    [pairs.length]
  );

  // Frame step: walk the single time-ordered sequence one pair at a time.
  const stepFrame = useCallback(
    (delta: 1 | -1) => goTo(currentIndex + delta),
    [goTo, currentIndex]
  );

  // Herd jump: next → start of the following run; prev → start of the current
  // run, or the previous run's start when already at a run boundary.
  const jumpHerd = useCallback(
    (dir: 1 | -1) => {
      const run = runIdByIndex[currentIndex] ?? 0;
      if (dir === 1) {
        if (run + 1 < runStarts.length) goTo(runStarts[run + 1]);
      } else {
        const start = runStarts[run] ?? 0;
        if (currentIndex > start) goTo(start);
        else if (run > 0) goTo(runStarts[run - 1]);
      }
    },
    [runIdByIndex, runStarts, currentIndex, goTo]
  );

  const currentRun = runIdByIndex[currentIndex] ?? 0;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < pairs.length - 1;
  const hasPrevHerd = currentRun > 0 || currentIndex > (runStarts[currentRun] ?? 0);
  const hasNextHerd = currentRun + 1 < runStarts.length;

  // ---- Obscured toggle (optimistic, reverts on failure). ----
  const toggleObscured = useCallback(
    async (annotationId: string) => {
      const current = annotations.find((a) => a.id === annotationId);
      if (!current) return;
      const desired = !current.obscured;
      const apply = (list: ChainAnnotation[]) =>
        list.map((a) =>
          a.id === annotationId ? { ...a, obscured: desired } : a
        );
      const revert = (list: ChainAnnotation[]) =>
        list.map((a) =>
          a.id === annotationId ? { ...a, obscured: current.obscured } : a
        );
      setAnnotations(apply);
      try {
        const updateAnnotation = client.models.Annotation
          .update as unknown as UpdateAnnotationObscured;
        const response = await updateAnnotation({
          id: annotationId,
          obscured: desired,
        });
        if (response?.errors?.length) {
          throw new Error(
            response.errors
              .map((e) => e.message ?? 'Unknown GraphQL error')
              .join('; ')
          );
        }
      } catch (err) {
        console.error('Failed to toggle obscured flag', err);
        setAnnotations(revert);
      }
    },
    [annotations]
  );

  // ---- Change label (chain-wide, optimistic, reverts on failure). ----
  const [labelChange, setLabelChange] = useState<{
    annotationId: string;
    currentCategoryId: string;
    chainIds: string[];
  } | null>(null);

  const buildChainIds = useCallback(
    (annotationId: string): string[] => {
      const ids = new Set<string>([annotationId]);
      const target = annotations.find((a) => a.id === annotationId);
      const chainKey = target?.objectId;
      if (chainKey) {
        for (const a of annotations) {
          if (a.objectId === chainKey || a.id === chainKey) ids.add(a.id);
        }
      }
      return Array.from(ids);
    },
    [annotations]
  );

  const handleChangeLabel = useCallback(
    (annotationId: string) => {
      const current = annotations.find((a) => a.id === annotationId);
      if (!current) return;
      setLabelChange({
        annotationId,
        currentCategoryId: current.categoryId,
        chainIds: buildChainIds(annotationId),
      });
    },
    [annotations, buildChainIds]
  );

  const applyLabelChange = useCallback(
    async (newCategoryId: string) => {
      const target = labelChange;
      if (!target) return;

      const ids = new Set(target.chainIds);
      const beforeMap = new Map<string, ChainAnnotation>();
      for (const aid of ids) {
        const a = annotations.find((x) => x.id === aid);
        if (a) beforeMap.set(aid, a);
      }

      const apply = (list: ChainAnnotation[]) =>
        list.map((a) =>
          ids.has(a.id) ? { ...a, categoryId: newCategoryId } : a
        );
      const rollback = (list: ChainAnnotation[]) =>
        list.map((a) => beforeMap.get(a.id) ?? a);

      setAnnotations(apply);
      setLabelChange(null);

      try {
        const updateAnnotation = client.models.Annotation
          .update as unknown as UpdateAnnotationCategory;
        const responses = await Promise.all(
          Array.from(ids).map((aid) =>
            updateAnnotation({ id: aid, categoryId: newCategoryId })
          )
        );
        const errors = responses.flatMap((response) => response?.errors ?? []);
        if (errors.length) {
          throw new Error(
            errors
              .map((e) => e.message ?? 'Unknown GraphQL error')
              .join('; ')
          );
        }
      } catch (err) {
        console.error('Failed to update annotation labels', err);
        setAnnotations(rollback);
      }
    },
    [annotations, labelChange]
  );

  // ---- Chain-tiles modal ----
  const [tilesChainId, setTilesChainId] = useState<string | null>(null);
  const onViewChainTiles = useCallback(
    (annotationId: string) => {
      const a = annotations.find((x) => x.id === annotationId);
      if (a) setTilesChainId(a.objectId ?? a.id);
    },
    [annotations]
  );
  // Preserve old `?chain=<id>` share links: open the modal and position the
  // maps at the first pair of the herd run containing that chain.
  useEffect(() => {
    if (chainParam) setTilesChainId(chainParam);
  }, [chainParam]);

  useEffect(() => {
    if (!chainParam) return;
    if (fetchStatus !== 'done' || herd.isLoading || pairs.length === 0) return;
    if (initialChainParamHandledRef.current === chainParam) return;

    const containingIndex = chainSets.findIndex((set) => set.has(chainParam));
    if (containingIndex < 0) return;

    const runId = runIdByIndex[containingIndex] ?? 0;
    setCurrentIndex(runStarts[runId] ?? containingIndex);
    initialChainParamHandledRef.current = chainParam;
  }, [
    chainParam,
    chainSets,
    fetchStatus,
    herd.isLoading,
    pairs.length,
    runIdByIndex,
    runStarts,
  ]);

  const openImageHrefFor = useCallback(
    (a: ChainAnnotation) =>
      `/surveys/${surveyId}/image/${a.imageId}/${annotationSetId}`,
    [surveyId, annotationSetId]
  );

  const currentPair = pairs[currentIndex];
  const loading = fetchStatus !== 'done' || herd.isLoading;

  return (
    <div
      className='w-100 h-100 d-flex flex-column'
      style={{ minHeight: 0, paddingTop: 12, paddingBottom: 12 }}
    >
      <div
        className='d-flex flex-row align-items-center gap-3 px-3 py-2'
        style={{ flexShrink: 0, background: '#4E5D6C', color: '#f8f9fa' }}
      >
        <div style={{ fontWeight: 600 }}>{project.name}</div>
        <div style={{ width: 220 }}>
          <Select
            value={selectedCategory}
            onChange={(v: SingleValue<{ label: string; value: string }>) =>
              setSelectedCategory(v)
            }
            isClearable
            options={categoryOptions}
            className='text-black'
            placeholder='All labels'
            isDisabled={loading}
          />
        </div>
        {!loading && pairs.length > 0 && (
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Pair {currentIndex + 1} of {pairs.length} · Herd {currentRun + 1} of{' '}
            {runStarts.length}
          </div>
        )}
        <Button
          variant='primary'
          className='ms-auto'
          onClick={() => navigate('/jobs')}
        >
          Save &amp; Exit
        </Button>
      </div>

      {loading ? (
        <div
          className='d-flex align-items-center justify-content-center text-muted'
          style={{ flex: 1 }}
        >
          {fetchStatus === 'error' ? (
            <span>
              Failed to load annotations{fetchError ? `: ${fetchError}` : '.'}
            </span>
          ) : (
            <span>
              <Spinner animation='border' size='sm' className='me-2' />
              Loading{' '}
              {fetchStatus !== 'done'
                ? `annotations… (${fetchCount} fetched)`
                : `images… (${herd.progress.images} fetched)`}
            </span>
          )}
        </div>
      ) : pairs.length === 0 ? (
        <div
          className='d-flex align-items-center justify-content-center text-muted'
          style={{ flex: 1 }}
        >
          <span>No image pairs with animals to review.</span>
        </div>
      ) : (
        <>
          <div className='mt-2' style={{ flex: 1, minHeight: 0 }}>
            {currentPair && (
              <HerdMapPair
                key={`${currentPair.image1Id}__${currentPair.image2Id}`}
                pair={currentPair}
                annotationsA={annotationsByImage[currentPair.image1Id] ?? []}
                annotationsB={annotationsByImage[currentPair.image2Id] ?? []}
                categoryColors={categoryColors}
                onToggleObscured={toggleObscured}
                onViewChainTiles={onViewChainTiles}
                onChangeLabel={handleChangeLabel}
                bearingForImage={bearingForImage}
                onImageBearingChange={onImageBearingChange}
                onRequestPrevPair={hasPrev ? () => stepFrame(-1) : undefined}
                onRequestNextPair={hasNext ? () => stepFrame(1) : undefined}
                onRequestPrevHerd={hasPrevHerd ? () => jumpHerd(-1) : undefined}
                onRequestNextHerd={hasNextHerd ? () => jumpHerd(1) : undefined}
                collapsed={navCollapsed}
                onCollapsedChange={setNavCollapsed}
              />
            )}
          </div>
          {!navCollapsed && (
            <HerdNavBar
              chainSets={chainSets}
              herdIds={pairs.map((pair) => pair.herdId)}
              lanes={[navLane]}
              activeIndex={currentIndex}
              activeLane={0}
              onJump={(i) => goTo(i)}
            />
          )}
        </>
      )}

      <ChainTilesModal
        show={tilesChainId !== null}
        onHide={() => setTilesChainId(null)}
        chainId={tilesChainId}
        annotations={annotations}
        categoryColors={categoryColors}
        onToggleObscured={toggleObscured}
        openImageHrefFor={openImageHrefFor}
      />
      <ChangeCategoryModal
        show={labelChange !== null}
        onClose={() => setLabelChange(null)}
        categories={setCategories}
        currentCategoryId={labelChange?.currentCategoryId}
        onSelectCategory={applyLabelChange}
        warning={
          labelChange
            ? `${labelChange.chainIds.length} annotation${
                labelChange.chainIds.length === 1 ? '' : 's'
              } in this chain will be relabelled.`
            : undefined
        }
      />
    </div>
  );
}
