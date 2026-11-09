import { GridHead, GridTable } from '@/components/GridTable';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { GlobalContext, ProjectContext } from './Context';
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

  const index = rows.findIndex((row) => row.id === selectedImageId);
  const selected = selectedImageId ? imagesById.get(selectedImageId) : null;
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const rowById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );
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

  useEffect(() => {
    if (rows.length && (!selectedImageId || !imagesById.has(selectedImageId)))
      onSelectImage(rows[0].id);
  }, [rows, selectedImageId, imagesById, onSelectImage]);

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    getItemKey: (i) => rows[i].id,
    overscan: 5,
  });

  useEffect(() => {
    if (index >= 0) virtualizer.scrollToIndex(index);
  }, [index, virtualizer]);

  const step = (delta: number) => {
    const next = rows[index + delta];
    if (next) onSelectImage(next.id);
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
            {loading ? 'Loading...' : `${rows.length.toLocaleString()} images`}
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
          ) : rows.length === 0 ? (
            <div className='p-3 text-sm text-muted-foreground'>
              No images match the filters.
            </div>
          ) : (
            <div
              className='relative'
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return (
                  <button
                    key={item.key}
                    ref={virtualizer.measureElement}
                    data-index={item.index}
                    type='button'
                    onClick={() => onSelectImage(row.id)}
                    className={cn(
                      'absolute inset-x-0 top-0 flex flex-col gap-1 border-b border-white/[0.08] px-2.5 py-2 text-left',
                      row.id === selectedImageId
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
      </GridTable>

      <div className='relative min-w-0 grow overflow-hidden border border-white/15'>
        {selected ? (
          <ReviewImageStage
            ids={rowIds}
            currentId={selected.id}
            lookup={lookup}
            annotationSetId={annotationSetId}
            visible={visible}
            buffer={visible}
            onStep={step}
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
      </div>
    </div>
  );
}
