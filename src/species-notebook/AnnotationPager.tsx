import { Spinner } from '@/components/ui/spinner';
import { useQueries } from '@tanstack/react-query';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ViewerFocus } from '../annotationTypes';
import { useUsers } from '../apiInterface';
import { GlobalContext } from '../Context';
import { storedDefaultZoom } from '../defaultZoomEvents';
import ReviewImageStage, { type StageSlot } from '../ReviewImageStage';
import type { ViewerCount } from '../reviewImageView';
import {
  imageAnnotationsQuery,
  imageMetaQuery,
  surveyCategoriesQuery,
  type ImageAnnotation,
} from './data';
import { EmptyNotice } from './EmptyNotice';
import { arrangeItems, isModelSource } from './galleryItems';
import { useLabelGallery, useViewerContexts } from './hooks';
import type { ImageMeta } from './imageMeta';
import { PaletteViewerContext, type PaletteViewer } from './paletteViewer';
import { SurveyScope } from './SurveyScope';
import type { GalleryItem, LabelRef, SurveyCategory } from './types';
import { targetZoom } from './viewerZoom';

const BEHIND = 2;
const AHEAD = 5;

const unique = (values: string[]) => [...new Set(values)];
const dataOf = <T,>(results: { data?: T; isError: boolean }[]) =>
  results.map((result) => (result.isError ? null : result.data));

function countsFor(
  rows: readonly ImageAnnotation[],
  categories: readonly SurveyCategory[],
): ViewerCount[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
  return [...counts]
    .map(([categoryId, count]) => ({
      key: categoryId,
      label: byId.get(categoryId)?.name ?? 'Unknown',
      color: byId.get(categoryId)?.color ?? '#adb5bd',
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function Badge({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`${className} px-1.5 text-xs leading-5 font-bold text-white`}
    >
      {children}
    </span>
  );
}

export function AnnotationPager({
  label,
  scale,
  onScale,
  viewerRef,
  onCurrent,
  onViewerKey,
}: {
  label: LabelRef;
  // Screen pixels per image pixel to open annotations at.
  scale: number | null;
  onScale: (scale: number) => void;
  viewerRef: React.MutableRefObject<HTMLDivElement | null>;
  onCurrent: (item: GalleryItem | null) => void;
  onViewerKey: (event: React.KeyboardEvent) => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const gallery = useLabelGallery(label);
  const key = `${label.projectId}/${label.name}`;
  const arranged = useMemo(() => arrangeItems(gallery.items), [gallery.items]);
  const [position, setPosition] = useState<{ key: string; id: string | null }>({
    key,
    id: null,
  });
  const selectedId = position.key === key ? position.id : null;

  const ids = useMemo(() => arranged.map((item) => item.id), [arranged]);
  const itemById = useMemo(
    () => new Map(arranged.map((item) => [item.id, item])),
    [arranged],
  );

  const currentId =
    selectedId && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);
  const index = currentId ? ids.indexOf(currentId) : -1;
  const item = (currentId && itemById.get(currentId)) || null;
  useEffect(() => {
    if (currentId && currentId !== selectedId)
      setPosition({ key, id: currentId });
  }, [currentId, selectedId, key]);
  useEffect(() => onCurrent(item), [onCurrent, item]);

  const nearby = useMemo(
    () =>
      index < 0
        ? []
        : ids
            .slice(Math.max(0, index - BEHIND), index + AHEAD + 1)
            .map((id) => itemById.get(id)!)
            .filter(Boolean),
    [ids, index, itemById],
  );
  const imageIds = useMemo(
    () => unique(nearby.map((i) => i.imageId)),
    [nearby],
  );
  const imageSets = useMemo(
    () => unique(nearby.map((i) => `${i.imageId}|${i.setId}`)),
    [nearby],
  );
  const projectIds = useMemo(
    () => unique(nearby.map((i) => i.projectId)),
    [nearby],
  );
  const metas = useQueries({
    queries: imageIds.map((id) => imageMetaQuery(id)),
    combine: dataOf<ImageMeta | null>,
  });
  const rows = useQueries({
    queries: imageSets.map((pair) => {
      const [imageId, setId] = pair.split('|');
      return imageAnnotationsQuery(client, imageId, setId);
    }),
    combine: dataOf<ImageAnnotation[]>,
  });
  const categories = useQueries({
    queries: projectIds.map((id) => surveyCategoriesQuery(id)),
    combine: dataOf<SurveyCategory[]>,
  });

  const metaById = useMemo(
    () => new Map(imageIds.map((id, i) => [id, metas[i]])),
    [imageIds, metas],
  );
  const slots = useMemo(() => {
    const rowsBy = new Map(imageSets.map((pair, i) => [pair, rows[i]]));
    const categoriesBy = new Map(
      projectIds.map((id, i) => [id, categories[i]]),
    );
    const out = new Map<string, StageSlot>();
    for (const near of nearby) {
      const meta = metaById.get(near.imageId);
      if (meta === undefined) continue;
      const imageRows = rowsBy.get(`${near.imageId}|${near.setId}`);
      const labels = categoriesBy.get(near.projectId);
      out.set(near.id, {
        image: meta?.sourceKey
          ? meta
          : {
              id: near.imageId,
              originalPath: meta?.originalPath,
              timestamp: meta?.timestamp,
            },
        points: [{ x: near.x, y: near.y }],
        counts: imageRows && labels ? countsFor(imageRows, labels) : [],
        annotationSetId: near.setId,
      });
    }
    return out;
  }, [nearby, metaById, imageSets, rows, projectIds, categories]);
  const lookup = useCallback((id: string) => slots.get(id) ?? null, [slots]);

  const focusCache = useRef(new Map<string, ViewerFocus>());
  const focusSeq = useRef(0);
  const focusFor = useCallback(
    (id: string) => {
      const cached = focusCache.current.get(id);
      if (id === currentId && cached) return cached;
      const near = itemById.get(id);
      const image = slots.get(id)?.image;
      if (!near || !image?.width || !image.height) return undefined;
      const zoom =
        targetZoom(
          { width: image.width, height: image.height },
          scale,
          storedDefaultZoom(near.projectId),
        ) ?? undefined;
      if (
        cached &&
        cached.x === near.x &&
        cached.y === near.y &&
        cached.zoom === zoom
      )
        return cached;
      focusSeq.current += 1;
      const focus = { x: near.x, y: near.y, zoom, seq: focusSeq.current };
      focusCache.current.set(id, focus);
      return focus;
    },
    [currentId, itemById, slots, scale],
  );

  const step = useCallback(
    (delta: number) => {
      const next = ids[index + delta];
      if (!next) return;
      // Focus would otherwise leave with the viewer being hidden.
      viewerRef.current?.focus({ preventScroll: true });
      setPosition({ key, id: next });
    },
    [ids, index, key, viewerRef],
  );

  const { users } = useUsers();
  const contexts = useViewerContexts(users);
  const wrapSlot = useCallback(
    (id: string, viewer: ReactNode) => {
      const near = itemById.get(id);
      return near ? (
        <SurveyScope projectId={near.projectId} contexts={contexts}>
          {viewer}
        </SurveyScope>
      ) : null;
    },
    [itemById, contexts],
  );

  const [viewerEl, setViewerEl] = useState<HTMLDivElement | null>(null);
  const setViewer = useCallback(
    (node: HTMLDivElement | null) => {
      viewerRef.current = node;
      setViewerEl(node);
    },
    [viewerRef],
  );
  const paletteViewer = useMemo<PaletteViewer>(
    () => ({ hotkeyTarget: viewerEl, onUserZoom: onScale }),
    [viewerEl, onScale],
  );

  const meta = item ? metaById.get(item.imageId) : undefined;
  const status = gallery.error
    ? 'Could not load annotations for this label.'
    : !item
      ? !gallery.loading && gallery.empty
        ? 'No examples to show.'
        : null
      : meta === null || (meta && !meta.sourceKey)
        ? 'This image is unavailable.'
        : null;
  const loading = !status && (gallery.loading || Boolean(item)) && !meta;

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col gap-3'>
      {gallery.empty && (
        <EmptyNotice
          name={label.name}
          loading={gallery.loading}
          borrowedSurveys={gallery.borrowedSurveys}
          hasExamples={ids.length > 0}
        />
      )}
      <div
        ref={setViewer}
        tabIndex={0}
        role='group'
        aria-roledescription='annotation viewer'
        aria-label={`${label.name} annotations`}
        onKeyDown={(event) => {
          const arrow =
            event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
          // Unavailable images have no annotator hotkeys.
          if (status && arrow) step(arrow);
          else onViewerKey(event);
        }}
        className='relative min-h-0 flex-1 overflow-hidden bg-[#1f2933] outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        {(status || loading) && (
          <div className='absolute inset-0 flex items-center justify-center gap-2 text-sm text-[#bcccdc]'>
            {status ?? <Spinner size='sm' />}
          </div>
        )}
        {item && (
          <PaletteViewerContext.Provider value={paletteViewer}>
            <ReviewImageStage
              ids={ids}
              currentId={item.id}
              lookup={lookup}
              annotationSetId={item.setId}
              visible
              buffer
              onStep={step}
              focusFor={focusFor}
              wrapSlot={wrapSlot}
            />
          </PaletteViewerContext.Provider>
        )}
        {item && (
          <div className='pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex gap-1'>
            {item.reviewed && <Badge className='bg-success'>QC ✓</Badge>}
            {isModelSource(item.source) && (
              <Badge className='bg-secondary'>Model</Badge>
            )}
            {item.borrowed && <Badge className='bg-info'>Other survey</Badge>}
          </div>
        )}
      </div>
    </div>
  );
}
