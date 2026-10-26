import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spinner } from '@/components/ui/spinner';
import { Combobox } from '@/components/ui/combobox';
import type { Lane } from '../../individual-id/utils/lanes';
import type { ImageType } from '../../schemaTypes';
import { buildHerdRuns } from '../utils/herdRuns';
import { buildHerdDisplayPairs } from '../utils/herdPairs';
import { CHAIN_LOCATION_SOURCES, HerdMapPair } from '../HerdMapPair';
import { HerdNavBar } from '../HerdNavBar';
import { ChainTilesModal } from '../components/ChainTilesModal';
import ChangeCategoryModal from '../../ChangeCategoryModal';
import { CommentModal } from './CommentModal';
import type { CategoryType } from '../../schemaTypes';
import type { ChainAnnotation } from '../types';
import { useSharedChainData } from './useSharedChainData';
import { useChainReviewFeedback } from './useChainReviewFeedback';
import '../ChainViewer.css';

interface Props {
  shareId: string;
}

/**
 * Read-only chain viewer for external reviewers. Same navigation and tiles as
 * the live herd view, but data comes from a frozen SharedChain* snapshot and
 * the obscured / relabel actions record a reviewer opinion in
 * ChainReviewFeedback instead of mutating any annotation.
 */
export function SharedHerdViewHarness({ shareId }: Props) {
  const { data, isLoading, isError, error } = useSharedChainData(shareId);
  const { overlay, setObscured, setRelabel, setComment } =
    useChainReviewFeedback(shareId);
  const [searchParams] = useSearchParams();
  const chainParam = searchParams.get('chain');

  // Snapshot annotations overlaid with this reviewer's recorded opinions.
  const annotations: ChainAnnotation[] = useMemo(() => {
    const base = data?.annotations ?? [];
    if (overlay.size === 0) return base;
    return base.map((a) => {
      const o = overlay.get(a.id);
      if (!o) return a;
      return {
        ...a,
        obscured: o.obscured ?? a.obscured,
        categoryId: o.categoryId ?? a.categoryId,
      };
    });
  }, [data?.annotations, overlay]);

  const sourceKeyFor = useCallback(
    (imageId: string) => data?.sourceKeyByImageId[imageId],
    [data?.sourceKeyByImageId]
  );

  const locationRowsFor = useCallback(
    (imageId: string) => data?.locationRowsByImageId[imageId],
    [data?.locationRowsByImageId]
  );

  // ChainTilesModal expects a Map; rebuild it here (component-local, not the
  // persisted query data) from the JSON-safe record.
  const tileMetaMap = useMemo(
    () => new Map(Object.entries(data?.metaByAnnotationId ?? {})),
    [data?.metaByAnnotationId]
  );

  // ---- Category filter / colours (from the snapshot) ----
  const [selectedCategory, setSelectedCategory] = useState<{
    label: string;
    value: string;
  } | null>(null);

  const setCategories = useMemo(
    () =>
      (data?.categories ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)) as unknown as CategoryType[],
    [data?.categories]
  );

  const categoryOptions = useMemo(
    () =>
      (data?.categories ?? [])
        .map((c) => ({ label: c.name, value: c.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data?.categories]
  );

  const categoryColors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of data?.categories ?? []) {
      if (c.id && c.color) m[c.id] = c.color;
    }
    return m;
  }, [data?.categories]);

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

  const { pairs, chainSets } = useMemo(() => {
    const ps = buildHerdDisplayPairs(
      data?.imagesById ?? {},
      data?.rawNeighbours ?? [],
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
  }, [data?.imagesById, data?.rawNeighbours, annotationsByImage]);

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
  const onImageBearingChange = useCallback((image: ImageType, bearing: number) => {
    setImageBearings((current) => {
      if (current.get(image.id) === bearing) return current;
      const next = new Map(current);
      next.set(image.id, bearing);
      return next;
    });
  }, []);

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

  const stepFrame = useCallback(
    (delta: 1 | -1) => goTo(currentIndex + delta),
    [goTo, currentIndex]
  );

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
  const hasPrevHerd =
    currentRun > 0 || currentIndex > (runStarts[currentRun] ?? 0);
  const hasNextHerd = currentRun + 1 < runStarts.length;

  // ---- Obscured opinion (records feedback, optimistic via overlay) ----
  const toggleObscured = useCallback(
    (annotationId: string) => {
      const current = annotations.find((a) => a.id === annotationId);
      if (!current) return;
      void setObscured(
        annotationId,
        current.objectId ?? current.id,
        !current.obscured
      );
    },
    [annotations, setObscured]
  );

  // ---- Label opinion (chain-wide, records feedback per member) ----
  const [labelChange, setLabelChange] = useState<{
    annotationId: string;
    currentCategoryId: string;
    chainIds: string[];
    chainId: string | null;
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
        chainId: current.objectId ?? current.id,
      });
    },
    [annotations, buildChainIds]
  );

  const applyLabelChange = useCallback(
    (newCategoryId: string) => {
      const target = labelChange;
      if (!target) return;
      setLabelChange(null);
      for (const aid of target.chainIds) {
        void setRelabel(aid, target.chainId, newCategoryId);
      }
    },
    [labelChange, setRelabel]
  );

  // ---- Comment opinion (per annotation, records feedback) ----
  const [commentTarget, setCommentTarget] = useState<{
    annotationId: string;
    chainId: string | null;
    current: string;
  } | null>(null);

  const handleComment = useCallback(
    (annotationId: string) => {
      const current = annotations.find((a) => a.id === annotationId);
      if (!current) return;
      setCommentTarget({
        annotationId,
        chainId: current.objectId ?? current.id,
        current: overlay.get(annotationId)?.comment ?? '',
      });
    },
    [annotations, overlay]
  );

  const applyComment = useCallback(
    (text: string) => {
      const target = commentTarget;
      if (!target) return;
      setCommentTarget(null);
      void setComment(target.annotationId, target.chainId, text);
    },
    [commentTarget, setComment]
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
  useEffect(() => {
    if (chainParam) setTilesChainId(chainParam);
  }, [chainParam]);

  useEffect(() => {
    if (!chainParam) return;
    if (isLoading || pairs.length === 0) return;
    if (initialChainParamHandledRef.current === chainParam) return;
    const containingIndex = chainSets.findIndex((set) => set.has(chainParam));
    if (containingIndex < 0) return;
    const runId = runIdByIndex[containingIndex] ?? 0;
    setCurrentIndex(runStarts[runId] ?? containingIndex);
    initialChainParamHandledRef.current = chainParam;
  }, [chainParam, chainSets, isLoading, pairs.length, runIdByIndex, runStarts]);

  // Reviewers can't open the org-gated full-image route; keep tiles self-contained.
  const openImageHrefFor = useCallback(() => '#', []);

  const currentPair = pairs[currentIndex];
  const loading = isLoading;
  const title =
    data?.share?.surveyName ?? data?.share?.annotationSetName ?? 'Chain review';

  return (
    <div
      className='w-full h-full flex flex-col'
      style={{ minHeight: 0, paddingTop: 12, paddingBottom: 12 }}
    >
      <div
        className='flex flex-row items-center gap-4 px-4 py-2'
        style={{ flexShrink: 0, background: '#4E5D6C', color: '#f8f9fa' }}
      >
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ width: 220 }}>
          <Combobox
            value={selectedCategory}
            onChange={(option) => setSelectedCategory(option)}
            clearable
            options={categoryOptions}
            placeholder='All labels'
            disabled={loading}
            name='Label filter'
          />
        </div>
        {!loading && pairs.length > 0 && (
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Pair {currentIndex + 1} of {pairs.length} · Herd {currentRun + 1} of{' '}
            {runStarts.length}
          </div>
        )}
        <span className='ml-auto' style={{ fontSize: 13, opacity: 0.85 }}>
          Read-only review
        </span>
      </div>

      {loading ? (
        <div
          className='flex items-center justify-center text-muted-foreground'
          style={{ flex: 1 }}
        >
          {isError ? (
            <span>
              Failed to load shared data
              {error ? `: ${(error as Error).message}` : '.'}
            </span>
          ) : (
            <span>
              <Spinner animation='border' size='sm' className='mr-2' />
              Loading shared chain data…
            </span>
          )}
        </div>
      ) : pairs.length === 0 ? (
        <div
          className='flex items-center justify-center text-muted-foreground'
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
                onComment={handleComment}
                bearingForImage={bearingForImage}
                onImageBearingChange={onImageBearingChange}
                onRequestPrevPair={hasPrev ? () => stepFrame(-1) : undefined}
                onRequestNextPair={hasNext ? () => stepFrame(1) : undefined}
                onRequestPrevHerd={hasPrevHerd ? () => jumpHerd(-1) : undefined}
                onRequestNextHerd={hasNextHerd ? () => jumpHerd(1) : undefined}
                collapsed={navCollapsed}
                onCollapsedChange={setNavCollapsed}
                sourceKeyFor={sourceKeyFor}
                locationSources={CHAIN_LOCATION_SOURCES}
                locationRowsFor={locationRowsFor}
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
        metaByAnnotationId={tileMetaMap}
        metaLoading={isLoading}
      />
      <ChangeCategoryModal
        show={labelChange !== null}
        onClose={() => setLabelChange(null)}
        categories={setCategories}
        currentCategoryId={labelChange?.currentCategoryId}
        onSelectCategory={applyLabelChange}
        warning={
          labelChange
            ? `Your label opinion will be recorded for ${
                labelChange.chainIds.length
              } annotation${labelChange.chainIds.length === 1 ? '' : 's'} in this chain.`
            : undefined
        }
      />
      <CommentModal
        show={commentTarget !== null}
        initial={commentTarget?.current ?? ''}
        onClose={() => setCommentTarget(null)}
        onSave={applyComment}
      />
    </div>
  );
}
