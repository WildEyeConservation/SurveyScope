import { GridHead, GridTable } from '@/components/GridTable';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  OtherViewsHandler,
  OtherViewsTarget,
  ViewerFocus,
} from './annotationTypes';
import { GlobalContext, ProjectContext } from './Context';
import { buildMinimapModel } from './exploreViews/minimapModel';
import { chainOtherCount, nearbyViews } from './exploreViews/otherViews';
import OtherViewsDrawer, {
  DRAWER_WIDTH,
  type OtherViewsState,
} from './exploreViews/OtherViewsDrawer';
import {
  MinimapCorner,
  MinimapFooter,
  type MinimapHint,
} from './exploreViews/SurveyMinimap';
import { cachedNeighbours } from './exploreViews/useImageNeighbours';
import { useNarrowViewport } from './exploreViews/useNarrowViewport';
import { insertVisit, keepCurrent } from './reviewImageList';
import ReviewImageStage, { type StageSlot } from './ReviewImageStage';
import { fileName, formatTime, type Point } from './reviewImageView';
import {
  extractUserIdFromOwner,
  setAnnotationsQuery,
  surveyGeoQuery,
} from './sightingQueries';
import { useInfoTagData } from './useInfoTags';

type SortMode = 'time' | 'count';

const NO_POINTS: Point[] = [];

type ImageRow = {
  id: string;
  name: string;
  timestamp: number;
  total: number;
  counts: { categoryId: string; count: number }[];
};

export default function ReviewImages({
  surveyId,
  annotationSetId,
  categoryIds,
  userIds,
  infoTagNames,
  transectIds,
  selectedImageId,
  onSelectImage,
  visitRequest,
  visible,
}: {
  surveyId: string;
  annotationSetId: string;
  categoryIds: string[];
  userIds: string[];
  infoTagNames: string[];
  transectIds: string[];
  selectedImageId: string | null;
  onSelectImage: (imageId: string) => void;
  visitRequest?: { imageId: string; seq: number } | null;
  visible: boolean;
}) {
  const { client } = useContext(GlobalContext)!;
  const {
    categoriesHook: { data: categories },
  } = useContext(ProjectContext)!;
  const [sort, setSort] = useState<SortMode>('time');

  const surveyQuery = useQuery(surveyGeoQuery(client, surveyId));
  const annotationsQuery = useQuery({
    ...setAnnotationsQuery(client, surveyId, annotationSetId),
    enabled: !!annotationSetId,
  });
  const { namesFor, dataSig: infoTagSig } = useInfoTagData(
    annotationSetId ? [annotationSetId] : [],
  );

  const imagesById = useMemo(
    () => new Map((surveyQuery.data?.images ?? []).map((i) => [i.id, i])),
    [surveyQuery.data],
  );
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((c) => [c.id, c])),
    [categories],
  );

  const filterKey = [categoryIds, userIds, infoTagNames, transectIds]
    .map((list) => list.join(','))
    .join('|');
  const rows = useMemo<ImageRow[]>(() => {
    const categorySet = new Set(categoryIds);
    const userSet = new Set(userIds);
    const tagSet = new Set(infoTagNames);
    const transectSet = new Set(transectIds);
    const byImage = new Map<string, Map<string, number>>();
    for (const a of annotationsQuery.data?.annotations ?? []) {
      if (!a.imageId || !a.categoryId) continue;
      if (categorySet.size && !categorySet.has(a.categoryId)) continue;
      if (userSet.size && !userSet.has(extractUserIdFromOwner(a.owner) ?? ''))
        continue;
      if (
        tagSet.size &&
        !namesFor(annotationSetId, a.id).some((n) => tagSet.has(n))
      )
        continue;
      if (transectSet.size) {
        const transectId = imagesById.get(a.imageId)?.transectId;
        if (!transectId || !transectSet.has(transectId)) continue;
      }
      const counts = byImage.get(a.imageId) ?? new Map<string, number>();
      counts.set(a.categoryId, (counts.get(a.categoryId) ?? 0) + 1);
      byImage.set(a.imageId, counts);
    }
    const out = [...byImage].map(([id, counts]) => {
      const image = imagesById.get(id);
      const list = [...counts]
        .map(([categoryId, count]) => ({ categoryId, count }))
        .sort((a, b) => b.count - a.count);
      return {
        id,
        name: fileName(image?.originalPath, id),
        timestamp: image?.timestamp ?? 0,
        total: list.reduce((sum, c) => sum + c.count, 0),
        counts: list,
      };
    });
    return out.sort((a, b) =>
      sort === 'count' ? b.total - a.total : a.timestamp - b.timestamp,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationsQuery.data, imagesById, filterKey, infoTagSig, sort]);

  const pointsByImage = useMemo(() => {
    const out = new Map<string, Point[]>();
    for (const a of annotationsQuery.data?.annotations ?? []) {
      if (!a.imageId || a.x == null || a.y == null) continue;
      const points = out.get(a.imageId) ?? [];
      points.push({ x: a.x, y: a.y });
      out.set(a.imageId, points);
    }
    return out;
  }, [annotationsQuery.data]);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const rowById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );

  const [visit, setVisit] = useState<{
    id: string;
    from: string | null;
  } | null>(null);

  // Keep the open image until navigation or a filter or sort change.
  const viewKey = `${annotationSetId}|${filterKey}|${sort}`;
  const shownRef = useRef({ key: viewKey, ids: [] as string[] });
  const ids = useMemo(() => {
    const shown = shownRef.current;
    const same = shown.key === viewKey;
    let next = same ? keepCurrent(rowIds, shown.ids, selectedImageId) : rowIds;
    if (same && visit?.id === selectedImageId && imagesById.has(visit.id))
      next = insertVisit(next, shown.ids, visit.id, visit.from);
    shownRef.current = { key: viewKey, ids: next };
    return next;
  }, [rowIds, viewKey, selectedImageId, visit, imagesById]);
  const currentId =
    selectedImageId && ids.includes(selectedImageId)
      ? selectedImageId
      : (ids[0] ?? null);
  const index = currentId ? ids.indexOf(currentId) : -1;
  const selected = currentId ? imagesById.get(currentId) : null;
  const rowFor = (id: string): ImageRow => {
    const row = rowById.get(id);
    if (row) return row;
    const image = imagesById.get(id);
    return {
      id,
      name: fileName(image?.originalPath, id),
      timestamp: image?.timestamp ?? 0,
      total: 0,
      counts: [],
    };
  };
  const lookup = useCallback(
    (id: string): StageSlot | null => {
      const image = imagesById.get(id);
      if (!image) return null;
      return {
        image,
        points: pointsByImage.get(id) ?? NO_POINTS,
        counts: (rowById.get(id)?.counts ?? []).map(({ categoryId, count }) => {
          const category = categoryById.get(categoryId);
          return {
            key: categoryId,
            label: category?.name ?? 'Unknown',
            color: category?.color ?? '#adb5bd',
            count,
          };
        }),
      };
    },
    [imagesById, pointsByImage, rowById, categoryById],
  );

  const visitPending =
    visit?.id === selectedImageId && !imagesById.has(visit.id);
  useEffect(() => {
    if (visitPending) return;
    if (currentId && currentId !== selectedImageId) onSelectImage(currentId);
  }, [currentId, selectedImageId, onSelectImage, visitPending]);

  const queryClient = useQueryClient();
  const narrow = useNarrowViewport();
  const [drawer, setDrawer] = useState<OtherViewsState | null>(null);
  const [focus, setFocus] = useState<{
    imageId: string;
    focus: ViewerFocus;
  } | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const [mapExpanded, setMapExpanded] = useState(false);
  // The drawer stays open only while the viewer shows an image it opened.
  const drawerImageRef = useRef<string | null>(null);
  const focusSeqRef = useRef(0);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  useEffect(() => {
    if (!visitRequest) return;
    const from = currentIdRef.current;
    if (visitRequest.imageId !== from) {
      setVisit({ id: visitRequest.imageId, from });
    }
    onSelectImage(visitRequest.imageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitRequest]);
  const setAnnotationsRef = useRef(annotationsQuery.data?.annotations ?? []);
  setAnnotationsRef.current = annotationsQuery.data?.annotations ?? [];
  const imagesByIdRef = useRef(imagesById);
  imagesByIdRef.current = imagesById;

  useEffect(() => {
    if (!currentId) return;
    setViewed((prev) =>
      prev.has(currentId) ? prev : new Set(prev).add(currentId),
    );
    if (drawerImageRef.current && drawerImageRef.current !== currentId) {
      drawerImageRef.current = null;
      setDrawer(null);
    }
    setFocus((prev) => (prev && prev.imageId !== currentId ? null : prev));
  }, [currentId]);

  const otherViews = useMemo<OtherViewsHandler>(() => {
    const otherCount = (t: OtherViewsTarget) =>
      chainOtherCount(setAnnotationsRef.current, t.objectId, t.id);
    return {
      describe: (target) => {
        const count = otherCount(target);
        if (count > 0) return { label: `Other views (${count})`, linked: true };
        const rows = cachedNeighbours(queryClient, target.imageId);
        if (!rows) return { label: 'Nearby images', linked: false };
        const sizeOf = (id: string) => {
          const image = imagesByIdRef.current.get(id);
          return image?.width && image.height
            ? { width: image.width, height: image.height }
            : undefined;
        };
        const n = nearbyViews(target.imageId, target, rows, sizeOf).length;
        return { label: `Nearby images (${n})`, linked: false };
      },
      open: (target) => {
        drawerImageRef.current = currentIdRef.current;
        setDrawer({ target, linked: otherCount(target) > 0 });
      },
    };
  }, [queryClient]);

  const closeDrawer = useCallback(() => {
    drawerImageRef.current = null;
    setDrawer(null);
  }, []);

  const jumpTo = useCallback(
    (imageId: string, point: Point | null) => {
      if (!imagesByIdRef.current.has(imageId)) return;
      drawerImageRef.current = imageId;
      focusSeqRef.current += 1;
      setFocus(
        point
          ? { imageId, focus: { ...point, seq: focusSeqRef.current } }
          : null,
      );
      const from = currentIdRef.current;
      if (imageId === from) return;
      setVisit({ id: imageId, from });
      onSelectImage(imageId);
    },
    [onSelectImage],
  );

  const focusFor = useCallback(
    (id: string) => (focus?.imageId === id ? focus.focus : undefined),
    [focus],
  );
  const imageInfo = useCallback(
    (id: string) => imagesById.get(id),
    [imagesById],
  );

  const minimapModel = useMemo(
    () =>
      surveyQuery.data
        ? buildMinimapModel(
            surveyQuery.data.images,
            surveyQuery.data.strata,
            surveyQuery.data.exclusions,
          )
        : null,
    [surveyQuery.data],
  );
  const hintFor = useCallback(
    (id: string): MinimapHint => {
      const image = imagesById.get(id);
      const counts = rowById.get(id)?.counts ?? [];
      return {
        title: fileName(image?.originalPath, id),
        detail:
          counts
            .map(
              ({ categoryId, count }) =>
                `${count} ${categoryById.get(categoryId)?.name ?? 'Unknown'}`,
            )
            .join(', ') || undefined,
      };
    },
    [imagesById, rowById, categoryById],
  );
  const drawerCategory = drawer
    ? categoryById.get(drawer.target.categoryId)
    : undefined;

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    getItemKey: (i) => ids[i],
    overscan: 5,
  });

  useEffect(() => {
    if (index >= 0) virtualizer.scrollToIndex(index);
  }, [index, virtualizer]);

  const step = (delta: number) => {
    const next = index >= 0 ? ids[index + delta] : undefined;
    if (next) onSelectImage(next);
  };

  if (!annotationSetId) {
    return (
      <div className='flex grow items-center justify-center'>
        Select an annotation set to begin.
      </div>
    );
  }

  const loading = surveyQuery.isLoading || annotationsQuery.isLoading;

  return (
    <div className='flex h-[calc(100vh-200px)] min-h-[480px] gap-3 pt-4'>
      <GridTable className='flex w-64 flex-none flex-col'>
        <GridHead className='flex items-center justify-between gap-2'>
          <span>
            {loading ? 'Loading...' : `${ids.length.toLocaleString()} images`}
          </span>
          <div className='flex border border-white/30 normal-case'>
            {(
              [
                ['time', 'Time'],
                ['count', 'Most'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type='button'
                title={
                  value === 'time'
                    ? 'In capture order'
                    : 'Images with the most sightings first'
                }
                onClick={() => setSort(value)}
                className={cn(
                  'px-2 py-0.5 tracking-normal',
                  sort === value
                    ? 'bg-primary text-white'
                    : 'hover:bg-white/10',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </GridHead>
        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              step(e.key === 'ArrowDown' ? 1 : -1);
            }
          }}
          className='relative min-h-0 grow overflow-y-auto outline-none'
        >
          {loading ? (
            <div className='flex items-center gap-2 p-3 text-sm text-muted-foreground'>
              <Spinner size='sm' />
              Loading sightings...
            </div>
          ) : ids.length === 0 ? (
            <div className='p-3 text-sm text-muted-foreground'>
              No images match the filters.
            </div>
          ) : (
            <div
              className='relative'
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rowFor(ids[item.index]);
                return (
                  <button
                    key={item.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    type='button'
                    onClick={() => onSelectImage(row.id)}
                    className={cn(
                      'absolute inset-x-0 top-0 flex flex-col gap-1 border-b border-white/[0.08] px-2.5 py-2 text-left',
                      row.id === currentId
                        ? 'bg-primary/15 shadow-[inset_3px_0_0_var(--color-primary)]'
                        : cn(
                            'hover:bg-white/[0.075]',
                            item.index % 2 === 0 && 'bg-black/5',
                          ),
                    )}
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    <span className='flex w-full items-baseline justify-between gap-2'>
                      <span className='truncate text-sm' title={row.name}>
                        {row.name}
                      </span>
                      <span className='flex-none text-[11px] text-muted-foreground tabular-nums'>
                        {formatTime(row.timestamp)}
                      </span>
                    </span>
                    <span className='flex flex-wrap gap-1'>
                      {!rowById.has(row.id) && (
                        <span className='bg-black/25 px-1.5 text-[11px] text-muted-foreground italic'>
                          Not in filter
                        </span>
                      )}
                      {row.counts.map(({ categoryId, count }) => {
                        const category = categoryById.get(categoryId);
                        return (
                          <span
                            key={categoryId}
                            className='flex items-center gap-1 bg-black/25 px-1.5 text-[11px]'
                          >
                            <span
                              className='size-2 flex-none'
                              style={{
                                backgroundColor: category?.color ?? '#adb5bd',
                              }}
                            />
                            {count} {category?.name ?? 'Unknown'}
                          </span>
                        );
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {minimapModel && (
          <MinimapFooter
            model={minimapModel}
            inFilterIds={ids}
            viewed={viewed}
            currentId={currentId}
            hintFor={hintFor}
            onSelect={onSelectImage}
            expanded={mapExpanded}
            onExpandedChange={() => setMapExpanded((prev) => !prev)}
          />
        )}
      </GridTable>

      <div className='relative min-w-0 grow overflow-hidden border border-white/15'>
        {selected ? (
          <ReviewImageStage
            ids={ids}
            currentId={selected.id}
            lookup={lookup}
            annotationSetId={annotationSetId}
            visible={visible}
            buffer={visible}
            onStep={step}
            otherViews={otherViews}
            neighbourOverlaps={imageInfo}
            focusFor={focusFor}
            rightInset={drawer && !narrow ? DRAWER_WIDTH : 0}
          />
        ) : (
          <div className='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
            {loading ? (
              <>
                <Spinner size='sm' />
                Loading images...
              </>
            ) : (
              'No image selected.'
            )}
          </div>
        )}
        {drawer && (
          <OtherViewsDrawer
            key={drawer.target.id}
            state={drawer}
            currentImageId={currentId}
            surveyId={surveyId}
            annotationSetId={annotationSetId}
            imageInfo={imageInfo}
            categoryColor={drawerCategory?.color ?? '#ff8c1a'}
            categoryName={drawerCategory?.name ?? 'Unknown'}
            narrow={narrow}
            onJump={jumpTo}
            onClose={closeDrawer}
          />
        )}
        {minimapModel && mapExpanded && (
          <MinimapCorner
            model={minimapModel}
            inFilterIds={ids}
            viewed={viewed}
            currentId={currentId}
            hintFor={hintFor}
            onSelect={onSelectImage}
            positionLabel={
              index >= 0
                ? `image ${(index + 1).toLocaleString()} of ${ids.length.toLocaleString()}`
                : undefined
            }
            onClose={() => setMapExpanded(false)}
          />
        )}
      </div>
    </div>
  );
}
