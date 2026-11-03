import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import AnnotationWorkspace from './AnnotationWorkspace';
import { GlobalContext, ProjectContext } from './Context';
import ImageThumb from './ImageThumb';
import {
  extractUserIdFromOwner,
  setAnnotationsQuery,
  surveyGeoQuery,
} from './sightingQueries';
import { useInfoTagData } from './useInfoTags';

const ROW_HEIGHT = 72;

type SortMode = 'time' | 'count';

type ImageRow = {
  id: string;
  name: string;
  timestamp: number;
  total: number;
  counts: { categoryId: string; count: number }[];
};

const fileName = (path: string | null | undefined, id: string) =>
  path?.split(/[\\/]/).pop() || id;

const formatTime = (timestamp: number) =>
  timestamp ? new Date(timestamp * 1000).toLocaleTimeString() : '';

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

  const index = rows.findIndex((row) => row.id === selectedImageId);
  const selected = selectedImageId ? imagesById.get(selectedImageId) : null;

  useEffect(() => {
    if (rows.length && (!selectedImageId || !imagesById.has(selectedImageId)))
      onSelectImage(rows[0].id);
  }, [rows, selectedImageId, imagesById, onSelectImage]);

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [listHeight, setListHeight] = useState(600);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => setListHeight(list.clientHeight));
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight)
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
  }, [index]);

  const step = (delta: number) => {
    const next = rows[index + delta];
    if (next) onSelectImage(next.id);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + listHeight) / ROW_HEIGHT) + 5,
  );

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
      <div className='flex w-64 flex-none flex-col border border-dark bg-white/[0.07]'>
        <div className='flex items-center justify-between gap-2 border-b border-dark bg-dark px-3 py-2 text-[11px] font-semibold tracking-wider text-white/85 uppercase'>
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
        </div>
        <div
          ref={listRef}
          tabIndex={0}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
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
            <div style={{ height: rows.length * ROW_HEIGHT }}>
              {rows.slice(first, last).map((row, offset) => (
                <button
                  key={row.id}
                  type='button'
                  onClick={() => onSelectImage(row.id)}
                  className={cn(
                    'absolute inset-x-0 flex items-center gap-2.5 border-b border-white/[0.08] px-2.5 text-left',
                    row.id === selectedImageId
                      ? 'bg-primary/15 shadow-[inset_3px_0_0_var(--color-primary)]'
                      : 'hover:bg-white/5',
                  )}
                  style={{
                    top: (first + offset) * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                  }}
                >
                  <ImageThumb
                    image={imagesById.get(row.id) ?? { id: row.id }}
                    className='h-12 w-16 flex-none bg-black/30'
                  />
                  <span className='flex min-w-0 flex-col gap-1'>
                    <span className='flex items-baseline justify-between gap-2'>
                      <span className='truncate text-sm' title={row.name}>
                        {row.name}
                      </span>
                      <span className='flex-none text-[11px] text-muted-foreground tabular-nums'>
                        {formatTime(row.timestamp)}
                      </span>
                    </span>
                    <span className='flex gap-1 overflow-hidden'>
                      {row.counts.map(({ categoryId, count }) => {
                        const category = categoryById.get(categoryId);
                        return (
                          <span
                            key={categoryId}
                            className='flex flex-none items-center gap-1 bg-black/25 px-1.5 text-[11px]'
                          >
                            <span
                              className='size-2'
                              style={{
                                backgroundColor: category?.color ?? '#adb5bd',
                              }}
                            />
                            {count} {category?.name ?? 'Unknown'}
                          </span>
                        );
                      })}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className='relative min-w-0 grow overflow-hidden border border-white/15'>
        {selected?.width && selected.height ? (
          <AnnotationWorkspace
            key={selected.id}
            embedded
            visible={visible}
            next={index < rows.length - 1 ? () => step(1) : undefined}
            prev={index > 0 ? () => step(-1) : undefined}
            hideZoomSetting
            hideNavButtons
            allowOutside
            location={{
              image: {
                id: selected.id,
                width: selected.width,
                height: selected.height,
              },
              annotationSetId,
              x: selected.width / 2,
              y: selected.height / 2,
              width: selected.width,
              height: selected.height,
            }}
          />
        ) : (
          !loading && (
            <div className='flex h-full items-center justify-center text-muted-foreground'>
              No image selected.
            </div>
          )
        )}

        {selected && (
          <div className='absolute top-2.5 left-1/2 z-10 flex max-w-[60%] -translate-x-1/2 items-center gap-2 bg-white px-1.5 py-1 text-sm text-[#212529] shadow-lg'>
            <button
              type='button'
              aria-label='Previous image'
              disabled={index <= 0}
              onClick={() => step(-1)}
              className='flex size-6 flex-none items-center justify-center bg-primary text-white disabled:opacity-40'
            >
              <ChevronLeft className='size-4' />
            </button>
            <span className='min-w-0 truncate'>
              <strong>{fileName(selected.originalPath, selected.id)}</strong>
              <span className='text-[#6c757d]'>
                {selected.timestamp
                  ? ` · ${formatTime(selected.timestamp)}`
                  : ''}
                {index >= 0 &&
                  ` · ${index + 1} of ${rows.length.toLocaleString()}`}
              </span>
            </span>
            <button
              type='button'
              aria-label='Next image'
              disabled={index < 0 || index >= rows.length - 1}
              onClick={() => step(1)}
              className='flex size-6 flex-none items-center justify-center bg-primary text-white disabled:opacity-40'
            >
              <ChevronRight className='size-4' />
            </button>
          </div>
        )}

        {index >= 0 && (
          <div className='absolute top-2.5 right-2.5 z-10 flex flex-col gap-1 bg-white px-3 py-2 text-sm text-[#212529] shadow-lg'>
            <span className='text-[10px] font-semibold tracking-wider text-[#6c757d] uppercase'>
              This image
            </span>
            {rows[index].counts.map(({ categoryId, count }) => {
              const category = categoryById.get(categoryId);
              return (
                <span key={categoryId} className='flex items-center gap-2'>
                  <span
                    className='size-2.5'
                    style={{ backgroundColor: category?.color ?? '#adb5bd' }}
                  />
                  {count} {category?.name ?? 'Unknown'}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
