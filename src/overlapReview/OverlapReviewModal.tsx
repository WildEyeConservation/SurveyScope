import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useQueries } from '@tanstack/react-query';
import {
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  ImageOffIcon,
  ScanIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { GlobalContext } from '../Context';
import ReviewImageStage, { type StageSlot } from '../ReviewImageStage';
import { fileName, formatTime } from '../reviewImageView';
import { fetchAllPaginatedResults } from '../utils';
import {
  type BoardRow,
  cameraKeyOf,
  layoutBoard,
  moveKey,
  NO_CAMERA,
  NO_TRANSECT,
  type OverlapImage,
  transectKeyOf,
} from './layout';
import { loadThumbnail } from './thumbnail';

export type SightingDot = {
  x: number;
  y: number;
  color: string;
  label: string;
};

const LABEL_W = 232;
const ROW_GAP = 4;
const SECTION_GAP = 16;
const BOARD_PAD = 12;
const MIN_HEIGHT = 80;
const ZOOM_STEP = 1.25;
// Share of the window the grid may take; the annotator gets the rest.
const GRID_SHARE = 0.55;

const rowKey = (transectId: string, cameraKey: string) =>
  `${transectId}:${cameraKey}`;
// Rotation is clockwise degrees on screen; the map's bearing is its negative.
const toRotation = (bearing: number) =>
  (((Math.round(-bearing / 90) * 90) % 360) + 360) % 360;
const aspectOf = (image: OverlapImage, rotation: number) =>
  rotation % 180 ? image.height / image.width : image.width / image.height;

const plural = (n: number, word: string) =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export default function OverlapReviewModal({
  show,
  onClose,
  surveyIds,
  images,
  transects,
  sightings,
  annotationSetId,
}: {
  show: boolean;
  onClose: () => void;
  surveyIds: string[];
  annotationSetId: string;
  images: OverlapImage[];
  transects: Map<string, { number: number; color: string }>;
  sightings: Map<string, SightingDot[]>;
}) {
  const { client } = useContext(GlobalContext)!;
  const cameraQueries = useQueries({
    queries: surveyIds.map((surveyId) => ({
      queryKey: ['overlap-review', 'cameras', surveyId],
      staleTime: 30 * 60 * 1000,
      enabled: show,
      queryFn: () =>
        fetchAllPaginatedResults<{ id: string; name: string }>(
          client.models.Camera.camerasByProjectId,
          { projectId: surveyId, selectionSet: ['id', 'name'] },
        ),
    })),
  });
  const cameraNames = useMemo(
    () =>
      new Map(
        cameraQueries.flatMap((q) => q.data ?? []).map((c) => [c.id, c.name]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraQueries.map((q) => q.dataUpdatedAt).join()],
  );
  const cameraName = (key: string) =>
    key === NO_CAMERA ? 'No camera' : (cameraNames.get(key) ?? 'Camera');
  const byCameraName = (a: string, b: string) =>
    (cameraNames.get(a) ?? a).localeCompare(cameraNames.get(b) ?? b);

  const [rowOrder, setRowOrder] = useState<Record<string, string[]>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rotations, setRotations] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState(1);
  const [showDots, setShowDots] = useState(true);
  useEffect(() => {
    setRowOrder({});
    setHidden(new Set());
    setRotations({});
    setZoom(1);
  }, [images]);
  const toggleHidden = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!body) return;
    const observer = new ResizeObserver(() =>
      setViewport({
        width: Math.floor(body.clientWidth * GRID_SHARE),
        height: body.clientHeight,
      }),
    );
    observer.observe(body);
    return () => observer.disconnect();
  }, [body]);

  const rowOfImage = useMemo(
    () =>
      new Map(
        images.map((i) => [i.id, rowKey(transectKeyOf(i), cameraKeyOf(i))]),
      ),
    [images],
  );
  const rotationOf = (row: string) => rotations[row] ?? 0;
  const rowAspects = useMemo(() => {
    const out = new Map<string, number>();
    for (const image of images) {
      const row = rowOfImage.get(image.id)!;
      const aspect = aspectOf(image, rotations[row] ?? 0);
      out.set(row, Math.max(out.get(row) ?? 0.5, aspect));
    }
    return out;
  }, [images, rowOfImage, rotations]);
  // Gaps scale with the images, so the board's width is proportional to height.
  const slotFor = (height: number) => (transectId: string, cameraKey: string) =>
    (rowAspects.get(rowKey(transectId, cameraKey)) ?? 1) * height * 1.03;

  const fitHeight = useMemo(() => {
    if (!viewport.height || !images.length) return MIN_HEIGHT;
    const probe = layoutBoard(images, slotFor(100), byCameraName);
    const shown = probe.sections
      .map(
        (s) =>
          s.rows.filter((r) => !hidden.has(`${s.transectId}:${r.cameraKey}`))
            .length,
      )
      .filter(Boolean);
    const rows = shown.reduce((a, b) => a + b, 0);
    const vertical =
      (viewport.height -
        BOARD_PAD * 2 -
        Math.max(shown.length - 1, 0) * SECTION_GAP -
        rows * ROW_GAP) /
      Math.max(rows, 1);
    const horizontal =
      ((viewport.width - LABEL_W - ROW_GAP - BOARD_PAD * 2) * 100) /
      Math.max(probe.width, 1);
    return Math.max(MIN_HEIGHT, Math.floor(Math.min(vertical, horizontal)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport, images, rowAspects, hidden]);
  const height = Math.max(MIN_HEIGHT, Math.round(fitHeight * zoom));

  const board = useMemo(
    () => layoutBoard(images, slotFor(height), byCameraName, rowOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images, height, rowAspects, cameraNames, rowOrder],
  );

  // Ctrl or ⌘ + wheel zooms the board rather than the page.
  useEffect(() => {
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => z * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [scroller]);

  const countOf = (rows: BoardRow[]) =>
    rows.reduce(
      (sum, row) =>
        sum +
        row.images.reduce(
          (s, { image }) => s + (sightings.get(image.id)?.length ?? 0),
          0,
        ),
      0,
    );
  const total = countOf(board.sections.flatMap((s) => s.rows));

  const dragRef = useRef<{ transectId: string; cameraKey: string } | null>(
    null,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const reorder = (transectId: string, cameraKey: string, index: number) => {
    const section = board.sections.find((s) => s.transectId === transectId);
    if (!section) return;
    const current = section.rows.map((r) => r.cameraKey);
    if (current.indexOf(cameraKey) === index) return;
    setRowOrder((prev) => ({
      ...prev,
      [transectId]: moveKey(current, cameraKey, index),
    }));
  };

  const transectLabel = (transectId: string) =>
    transectId === NO_TRANSECT
      ? 'No transect'
      : `Transect ${transects.get(transectId)?.number ?? '?'}`;
  const shownSections = board.sections
    .map((section) => ({
      section,
      visible: section.rows.filter(
        (r) => !hidden.has(`${section.transectId}:${r.cameraKey}`),
      ),
    }))
    .filter(({ visible }) => visible.length > 0);
  const gridRows = shownSections.flatMap(({ visible }) =>
    visible.map((row) => row.images.map(({ image }) => image.id)),
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const position = (() => {
    for (let r = 0; r < gridRows.length; r++) {
      const c = gridRows[r].indexOf(currentId ?? '');
      if (c >= 0) return { r, c };
    }
    return null;
  })();
  const firstId = gridRows[0]?.[0] ?? null;
  useEffect(() => {
    if (show && !position) setCurrentId(firstId);
  }, [show, position, firstId]);

  const move = (dc: number, dr: number) => {
    if (!position) return;
    const row = gridRows[position.r + dr];
    if (!row?.length) return;
    const c = dr ? Math.min(position.c, row.length - 1) : position.c + dc;
    if (row[c]) setCurrentId(row[c]);
  };
  const moveRef = useRef(move);
  moveRef.current = move;

  // Arrows walk the grid; the annotator would otherwise only step sideways.
  useEffect(() => {
    if (!show) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      const step = steps[e.key];
      const target = e.target as HTMLElement | null;
      if (!step || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (
        target?.closest(
          'input, textarea, select, [data-grip], [role=menu], [role=listbox], [role=combobox]',
        )
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      moveRef.current(...step);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show]);

  const imageById = useMemo(
    () => new Map(images.map((image) => [image.id, image])),
    [images],
  );
  const lookup = useCallback(
    (id: string): StageSlot | null => {
      const image = imageById.get(id);
      if (!image) return null;
      const dots = sightings.get(id) ?? [];
      const counts = new Map<string, { color: string; count: number }>();
      for (const dot of dots) {
        const entry = counts.get(dot.label) ?? { color: dot.color, count: 0 };
        entry.count++;
        counts.set(dot.label, entry);
      }
      return {
        image,
        points: dots,
        counts: [...counts]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([label, { color, count }]) => ({
            key: label,
            label,
            color,
            count,
          })),
      };
    },
    [imageById, sightings],
  );
  const currentRow = position ? gridRows[position.r] : [];

  const hiddenRows = board.sections.flatMap((s) =>
    s.rows
      .filter((r) => hidden.has(`${s.transectId}:${r.cameraKey}`))
      .map((r) => ({
        id: `${s.transectId}:${r.cameraKey}`,
        transectLabel: transectLabel(s.transectId),
        cameraKey: r.cameraKey,
      })),
  );

  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        fullscreen
        className='m-4 h-[calc(100%-2rem)] w-[calc(100%-2rem)] border'
      >
        <DialogHeader className='flex-wrap gap-x-6'>
          <div className='flex min-w-0 items-baseline gap-4'>
            <DialogTitle>Review overlap</DialogTitle>
            <span className='text-muted-foreground'>
              {plural(images.length, 'image')} ·{' '}
              {plural(board.sections.length, 'transect')} ·{' '}
              {plural(total, 'sighting')}
            </span>
          </div>
          <div className='ml-auto flex flex-wrap items-center gap-4'>
            {hiddenRows.length > 0 && (
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-muted-foreground'>Hidden</span>
                {hiddenRows.map(({ id, transectLabel, cameraKey }) => (
                  <Button
                    key={id}
                    variant='outline'
                    title={`Show ${cameraName(cameraKey)}`}
                    onClick={() => toggleHidden(id)}
                  >
                    <EyeIcon className='size-4' />
                    <span className='max-w-56 truncate'>
                      {transectLabel} · {cameraName(cameraKey)}
                    </span>
                  </Button>
                ))}
              </div>
            )}
            <div className='flex items-center gap-2'>
              <Switch
                id='overlap-dots'
                checked={showDots}
                onCheckedChange={setShowDots}
              />
              <Label htmlFor='overlap-dots' className='mb-0'>
                Sightings
              </Label>
            </div>
            <div className='flex'>
              <Button
                variant='outline'
                size='icon'
                aria-label='Zoom out'
                title='Zoom out (Ctrl + scroll)'
                disabled={height <= MIN_HEIGHT}
                onClick={() => setZoom((z) => z / ZOOM_STEP)}
              >
                <ZoomOutIcon className='size-4' />
              </Button>
              <Button
                variant='outline'
                className='-ml-px gap-2'
                title='Fit to window'
                disabled={zoom === 1}
                onClick={() => setZoom(1)}
              >
                <ScanIcon className='size-4' />
                Fit
              </Button>
              <Button
                variant='outline'
                size='icon'
                className='-ml-px'
                aria-label='Zoom in'
                title='Zoom in (Ctrl + scroll)'
                onClick={() => setZoom((z) => z * ZOOM_STEP)}
              >
                <ZoomInIcon className='size-4' />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div ref={setBody} className='flex min-h-0 flex-1'>
          <div
            ref={setScroller}
            className='shrink-0 overflow-auto bg-black/15'
            style={{
              width: Math.min(
                LABEL_W + ROW_GAP + board.width + BOARD_PAD * 2,
                viewport.width,
              ),
            }}
          >
            <div
              className='flex min-w-full flex-col'
              style={{
                width: LABEL_W + ROW_GAP + board.width + BOARD_PAD * 2,
                padding: BOARD_PAD,
                gap: SECTION_GAP,
              }}
            >
              {shownSections.map(({ section, visible }) => {
                const color =
                  transects.get(section.transectId)?.color ?? '#999999';
                const movable = visible.length > 1;
                const indexOf = (cameraKey: string) =>
                  section.rows.findIndex((r) => r.cameraKey === cameraKey);
                return (
                  <section
                    key={section.transectId}
                    className='relative flex flex-col'
                    style={{ gap: ROW_GAP }}
                  >
                    {visible.map((row, visibleIndex) => {
                      const id = `${section.transectId}:${row.cameraKey}`;
                      const name = cameraName(row.cameraKey);
                      const allowDrop = (e: DragEvent) => {
                        if (dragRef.current?.transectId !== section.transectId)
                          return;
                        e.preventDefault();
                        reorder(
                          section.transectId,
                          dragRef.current.cameraKey,
                          indexOf(row.cameraKey),
                        );
                      };
                      const onKey = (e: KeyboardEvent) => {
                        const step =
                          e.key === 'ArrowUp'
                            ? -1
                            : e.key === 'ArrowDown'
                              ? 1
                              : 0;
                        const target = visible[visibleIndex + step];
                        if (!step || !target) return;
                        e.preventDefault();
                        reorder(
                          section.transectId,
                          row.cameraKey,
                          indexOf(target.cameraKey),
                        );
                      };
                      return (
                        <div
                          key={id}
                          className={cn(
                            'flex',
                            dragging === id && 'opacity-40',
                          )}
                          style={{ gap: ROW_GAP }}
                          onDragOver={allowDrop}
                          onDrop={(e) => e.preventDefault()}
                        >
                          <div
                            draggable={movable}
                            onDragStart={(e) => {
                              dragRef.current = {
                                transectId: section.transectId,
                                cameraKey: row.cameraKey,
                              };
                              setDragging(id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragEnd={() => {
                              dragRef.current = null;
                              setDragging(null);
                            }}
                            className={cn(
                              'sticky left-0 z-20 flex shrink-0 flex-col gap-0.5 bg-[#424f5c] py-1.5 pr-1 pl-3',
                              movable && 'cursor-grab active:cursor-grabbing',
                            )}
                            style={{
                              width: LABEL_W,
                              boxShadow: `inset 3px 0 0 ${color}`,
                            }}
                          >
                            <div className='flex items-center'>
                              <span className='text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                                {transectLabel(section.transectId)}
                              </span>
                              <div className='ml-auto flex'>
                                {movable && (
                                  <button
                                    type='button'
                                    aria-label={`Move ${name} up or down`}
                                    title='Drag, or press ↑ ↓, to reorder'
                                    className='p-1 text-muted-foreground hover:text-foreground'
                                    data-grip
                                    onKeyDown={onKey}
                                  >
                                    <GripVerticalIcon className='size-4' />
                                  </button>
                                )}
                                <button
                                  type='button'
                                  aria-label={`Hide ${name}`}
                                  title='Hide camera'
                                  className='p-1 text-muted-foreground hover:text-foreground'
                                  onClick={() => toggleHidden(id)}
                                >
                                  <EyeOffIcon className='size-4' />
                                </button>
                              </div>
                            </div>
                            <span className='truncate text-sm' title={name}>
                              {name}
                            </span>
                            <span className='text-xs text-muted-foreground'>
                              {plural(countOf([row]), 'sighting')}
                            </span>
                          </div>
                          <div
                            className='relative shrink-0'
                            style={{ width: board.width, height }}
                          >
                            {row.images.map(({ image, left }) => (
                              <Thumbnail
                                key={image.id}
                                image={image}
                                left={left}
                                height={height}
                                dots={
                                  showDots ? sightings.get(image.id) : undefined
                                }
                                root={scroller}
                                current={image.id === currentId}
                                rotation={rotationOf(id)}
                                onSelect={() => setCurrentId(image.id)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
          <div className='relative min-w-0 flex-1 overflow-hidden border-l border-black/30'>
            {currentId && (
              <ReviewImageStage
                ids={currentRow}
                currentId={currentId}
                lookup={lookup}
                annotationSetId={annotationSetId}
                visible={show}
                buffer={show}
                onStep={(delta) => move(delta, 0)}
                bearingFor={(id) => -rotationOf(rowOfImage.get(id) ?? '')}
                onBearingChange={(id, bearing) => {
                  const row = rowOfImage.get(id);
                  if (!row || toRotation(bearing) === rotationOf(row)) return;
                  setRotations((prev) => ({
                    ...prev,
                    [row]: toRotation(bearing),
                  }));
                }}
              />
            )}
          </div>
        </div>
        <DialogFooter className='justify-start'>
          <Button variant='ghost' onClick={onClose}>
            Close
          </Button>
          <span className='ml-auto text-sm text-muted-foreground'>
            Arrow keys move through the grid · Drag cameras so the rows that
            overlap sit together
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Thumbnail({
  image,
  left,
  height,
  dots,
  root,
  current,
  onSelect,
  rotation,
}: {
  image: OverlapImage;
  left: number;
  height: number;
  dots?: SightingDot[];
  root: HTMLElement | null;
  current: boolean;
  onSelect: () => void;
  rotation: number;
}) {
  const { client } = useContext(GlobalContext)!;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current)
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const turned = rotation % 180 !== 0;
  const width = Math.round(height * aspectOf(image, rotation));
  // The unrotated picture, sized so that once turned it fills the tile.
  const inner = turned ? { width: height, height: width } : { width, height };

  // Fetch sharper tiles as the board zooms in, never softer ones.
  const wanted =
    Math.max(inner.width, inner.height) * (window.devicePixelRatio || 1);
  const [target, setTarget] = useState(0);
  useEffect(() => {
    if (wanted > target * 1.4) setTarget(Math.ceil(wanted));
  }, [wanted, target]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !root || !target) return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        loadThumbnail(client, image, target, controller.signal).then(
          (next) => {
            if (controller.signal.aborted) URL.revokeObjectURL(next);
            else setUrl(next);
          },
          () => {
            if (!controller.signal.aborted) setFailed(true);
          },
        );
      },
      { root, rootMargin: '50%' },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [client, image, root, target]);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  const dotSize = Math.max(4, Math.min(9, height / 30));
  const count = dots?.length ?? 0;
  return (
    <button
      type='button'
      ref={ref}
      aria-pressed={current}
      onClick={onSelect}
      className={cn(
        'absolute top-0 overflow-hidden bg-black/30 p-0 ring-1 ring-black/40',
        current && 'z-10 outline-3 -outline-offset-3 outline-primary',
      )}
      style={{ left, width, height }}
      title={`${fileName(image.originalPath, image.id)} · ${formatTime(image.timestamp)}`}
    >
      {failed && !url && (
        <ImageOffIcon className='absolute inset-0 m-auto size-5 text-muted-foreground' />
      )}
      <span
        className='absolute block'
        style={{
          ...inner,
          left: (width - inner.width) / 2,
          top: (height - inner.height) / 2,
          transform: rotation ? `rotate(${rotation}deg)` : undefined,
        }}
      >
        {url && (
          <img src={url} alt='' className='size-full' draggable={false} />
        )}
        {dots?.map((dot, index) => (
          <span
            key={index}
            className='absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/60'
            style={{
              left: `${(dot.x / image.width) * 100}%`,
              top: `${(dot.y / image.height) * 100}%`,
              width: dotSize,
              height: dotSize,
              background: dot.color,
            }}
          />
        ))}
      </span>
      {count > 0 && (
        <span className='absolute top-1 right-1 bg-black/70 px-1.5 text-xs leading-5 font-semibold text-white'>
          {count}
        </span>
      )}
    </button>
  );
}
