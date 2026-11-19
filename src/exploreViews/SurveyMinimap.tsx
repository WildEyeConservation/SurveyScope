import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  LocateFixed,
  Map as MapIcon,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { strataColors } from '../survey/transectStrata';
import {
  boundsOf,
  fitView,
  flightDirection,
  nearestWithin,
  toScreen,
  zoomAt,
  type Plane,
  type View,
} from './minimap';
import type { MinimapModel } from './minimapModel';

export type MinimapHint = { title: string; detail?: string };

type Theme = 'dark' | 'light';

const COLORS = {
  dark: {
    dot: 'rgba(255,255,255,0.22)',
    inFilter: '#ebebeb',
    viewed: '#5bc0de',
    hover: '#ffffff',
  },
  light: {
    dot: '#b4bcc4',
    inFilter: '#4e5d6c',
    viewed: '#5bc0de',
    hover: '#212529',
  },
};
const CURRENT = '#df6919';
const HIT_PX = 8;
const STORAGE_KEY = 'explore.surveyPosition.collapsed';

function useSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

function traceRing(
  ctx: CanvasRenderingContext2D,
  view: View,
  ring: [number, number][],
) {
  ctx.beginPath();
  ring.forEach(([x, y], k) => {
    const [sx, sy] = toScreen(view, x, y);
    if (k === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

function drawBase(
  canvas: HTMLCanvasElement,
  model: MinimapModel,
  view: View,
  width: number,
  height: number,
  theme: Theme,
) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  model.strata.forEach((ring, k) => {
    const color = strataColors[k % strataColors.length];
    traceRing(ctx, view, ring);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  for (const ring of model.exclusions) {
    traceRing(ctx, view, ring);
    ctx.fillStyle = 'rgba(255,0,0,0.15)';
    ctx.fill();
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = COLORS[theme].dot;
  const { xs, ys } = model.plane;
  for (let i = 0; i < xs.length; i++) {
    const [sx, sy] = toScreen(view, xs[i], ys[i]);
    if (sx < -2 || sy < -2 || sx > width + 2 || sy > height + 2) continue;
    ctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5);
  }
}

function MinimapCanvas({
  model,
  view,
  onViewChange,
  theme,
  inFilter,
  viewed,
  currentIdx,
  hintFor,
  onSelect,
  onSize,
  className,
}: {
  model: MinimapModel;
  view: View | null;
  onViewChange?: (view: View) => void;
  theme: Theme;
  inFilter: number[];
  viewed: Set<string>;
  currentIdx: number;
  hintFor: (imageId: string) => MinimapHint;
  onSelect: (imageId: string) => void;
  onSize: (size: { width: number; height: number }) => void;
  className?: string;
}) {
  const [setHost, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState(-1);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => onSize(size), [size, onSize]);

  useEffect(() => {
    if (!view || !size.width || !size.height) return;
    baseRef.current ??= document.createElement('canvas');
    drawBase(baseRef.current, model, view, size.width, size.height, theme);
  }, [model, view, size, theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base || !view || !size.width || !size.height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = COLORS[theme];
    const k = theme === 'light' ? 1.2 : 1;
    const { xs, ys } = model.plane;
    const at = (i: number) => toScreen(view, xs[i], ys[i]);
    const dot = (i: number, r: number, color: string) => {
      const [sx, sy] = at(i);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (const i of inFilter) {
      const id = model.images[i].id;
      dot(i, 2.2 * k, viewed.has(id) ? colors.viewed : colors.inFilter);
    }
    if (currentIdx >= 0 && Number.isFinite(xs[currentIdx])) {
      const [cx, cy] = at(currentIdx);
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(223,105,25,0.18)';
      ctx.fill();
      ctx.strokeStyle = CURRENT;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const dir = flightDirection(
        model.plane,
        model.prevIdx[currentIdx],
        currentIdx,
        model.nextIdx[currentIdx],
      );
      if (dir) {
        const [dx, dy] = dir;
        ctx.beginPath();
        ctx.moveTo(cx + dx * 13, cy + dy * 13);
        ctx.lineTo(cx + dx * 7 - dy * 3.5, cy + dy * 7 + dx * 3.5);
        ctx.lineTo(cx + dx * 7 + dy * 3.5, cy + dy * 7 - dx * 3.5);
        ctx.closePath();
        ctx.fillStyle = CURRENT;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = CURRENT;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (hover >= 0) {
      const [hx, hy] = at(hover);
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.strokeStyle = colors.hover;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }, [model, view, size, theme, inFilter, viewed, currentIdx, hover]);

  const pointer = (e: ReactMouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };

  const onMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const [sx, sy] = pointer(e);
    const drag = dragRef.current;
    if (drag && onViewChange) {
      const dx = sx - drag.x;
      const dy = sy - drag.y;
      if (drag.moved || Math.hypot(dx, dy) > 3) {
        drag.moved = true;
        drag.x = sx;
        drag.y = sy;
        setHover(-1);
        onViewChange({ ...view, tx: view.tx + dx, ty: view.ty + dy });
        return;
      }
    }
    setHover(nearestWithin(model.plane, inFilter, view, sx, sy, HIT_PX));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onViewChange || !view) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      onViewChange(
        zoomAt(
          view,
          e.clientX - rect.left,
          e.clientY - rect.top,
          e.deltaY < 0 ? 1.25 : 0.8,
        ),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [view, onViewChange]);

  const hint = hover >= 0 ? hintFor(model.images[hover].id) : null;
  const hintAt = hover >= 0 && view ? at2(view, model.plane, hover) : null;

  return (
    <div ref={setHost} className={cn('relative overflow-hidden', className)}>
      <canvas
        ref={canvasRef}
        className={cn(
          'block size-full',
          hover >= 0 ? 'cursor-pointer' : onViewChange && 'cursor-grab',
        )}
        style={{ width: size.width, height: size.height }}
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHover(-1);
          dragRef.current = null;
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const [x, y] = pointer(e);
          dragRef.current = { x, y, moved: false };
        }}
        onMouseUp={() => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag?.moved) return;
          if (hover >= 0) onSelect(model.images[hover].id);
        }}
      />
      {hint && hintAt && (
        <div
          className='pointer-events-none absolute z-[2] -translate-x-1/2 -translate-y-full bg-[#212529] px-1.5 py-1 text-[11px] leading-tight whitespace-nowrap text-white shadow-md'
          style={{
            left: Math.min(Math.max(hintAt[0], 60), size.width - 60),
            top: hintAt[1] - 8,
          }}
        >
          <div className='font-medium'>{hint.title}</div>
          {hint.detail && <div className='opacity-80'>{hint.detail}</div>}
          <div className='opacity-60'>Click to open</div>
        </div>
      )}
    </div>
  );
}

const at2 = (view: View, plane: Plane, i: number) =>
  toScreen(view, plane.xs[i], plane.ys[i]);

function Legend({ theme }: { theme: Theme }) {
  const c = COLORS[theme];
  const item = (color: string, label: string, r: number) => (
    <span className='inline-flex items-center gap-1'>
      <i
        className='inline-block rounded-full'
        style={{ width: r * 2, height: r * 2, backgroundColor: color }}
      />
      {label}
    </span>
  );
  return (
    <div
      className={cn(
        'flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px]',
        theme === 'light' ? 'text-[#6c757d]' : 'text-muted-foreground',
      )}
    >
      {item(CURRENT, 'Current', 4)}
      {item(c.inFilter, 'In filter', 3)}
      {item(c.viewed, 'Viewed', 3)}
      {item(c.dot, 'Other images', 2)}
    </div>
  );
}

type SharedProps = {
  model: MinimapModel;
  inFilterIds: string[];
  viewed: Set<string>;
  currentId: string | null;
  hintFor: (imageId: string) => MinimapHint;
  onSelect: (imageId: string) => void;
};

function useShared({ model, inFilterIds, currentId }: SharedProps) {
  const inFilter = useMemo(() => {
    const out: number[] = [];
    for (const id of inFilterIds) {
      const i = model.indexById.get(id);
      if (i != null && Number.isFinite(model.plane.xs[i])) out.push(i);
    }
    return out;
  }, [model, inFilterIds]);
  const currentIdx = currentId ? (model.indexById.get(currentId) ?? -1) : -1;
  const transectId =
    currentIdx >= 0 ? model.images[currentIdx].transectId : null;
  const transectNo = transectId ? model.transectNumber.get(transectId) : null;
  return { inFilter, currentIdx, transectId, transectNo };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Panel persistence is best-effort.
  }
}

export function MinimapFooter(
  props: SharedProps & { expanded: boolean; onExpandedChange: () => void },
) {
  const { model, viewed, hintFor, onSelect, expanded, onExpandedChange } =
    props;
  const { inFilter, currentIdx, transectNo } = useShared(props);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const view = useMemo(
    () =>
      model.surveyBounds && size.width && size.height
        ? fitView(model.surveyBounds, size.width, size.height, 8)
        : null,
    [model, size],
  );
  const toggle = () =>
    setCollapsed((prev) => {
      writeCollapsed(!prev);
      return !prev;
    });

  return (
    <div className='flex-none border-t border-dark'>
      <div className='flex items-center gap-2 bg-table-head px-3 py-2 text-sm font-bold text-white'>
        <button
          type='button'
          onClick={toggle}
          aria-expanded={!collapsed}
          className='flex min-w-0 grow items-center gap-1.5 text-left'
        >
          <MapIcon className='size-4 flex-none' />
          <span className='truncate'>Survey position</span>
          {transectNo != null && (
            <span className='ml-auto font-normal'>T{transectNo}</span>
          )}
          {collapsed ? (
            <ChevronRight
              className={cn(
                'size-4 flex-none',
                transectNo == null && 'ml-auto',
              )}
            />
          ) : (
            <ChevronDown
              className={cn(
                'size-4 flex-none',
                transectNo == null && 'ml-auto',
              )}
            />
          )}
        </button>
        <button
          type='button'
          onClick={onExpandedChange}
          title={expanded ? 'Close the larger map' : 'Open a larger map'}
          aria-pressed={expanded}
          className={cn(
            'flex-none p-0.5 hover:bg-white/10',
            expanded && 'bg-white/15',
          )}
        >
          <Maximize2 className='size-3.5' />
        </button>
      </div>
      {!collapsed && (
        <>
          <MinimapCanvas
            model={model}
            view={view}
            theme='dark'
            inFilter={inFilter}
            viewed={viewed}
            currentIdx={currentIdx}
            hintFor={hintFor}
            onSelect={onSelect}
            onSize={setSize}
            className='h-[150px] bg-black/20'
          />
          <div className='px-2 pt-1 pb-1.5'>
            <Legend theme='dark' />
          </div>
        </>
      )}
    </div>
  );
}

type Mode = 'transect' | 'survey' | 'free';

export function MinimapCorner(
  props: SharedProps & {
    positionLabel?: string;
    onClose: () => void;
  },
) {
  const { model, viewed, hintFor, onSelect, positionLabel, onClose } = props;
  const { inFilter, currentIdx, transectId, transectNo } = useShared(props);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>('transect');
  const [freeView, setFreeView] = useState<View | null>(null);

  const fitted = useMemo(() => {
    if (!size.width || !size.height) return null;
    const members =
      mode === 'transect' && transectId
        ? model.transectMembers.get(transectId)
        : undefined;
    const bounds = members
      ? boundsOf(model.plane, members)
      : model.surveyBounds;
    if (!bounds) return null;
    const span = model.surveyBounds
      ? Math.max(
          model.surveyBounds.maxX - model.surveyBounds.minX,
          model.surveyBounds.maxY - model.surveyBounds.minY,
        ) / 20
      : 0;
    return fitView(bounds, size.width, size.height, 14, span);
  }, [model, size, mode, transectId]);
  const view = mode === 'free' ? freeView : fitted;

  // A panned view only recentres when the user moves to an image outside it.
  const followedIdxRef = useRef(currentIdx);
  useEffect(() => {
    if (followedIdxRef.current === currentIdx) return;
    followedIdxRef.current = currentIdx;
    if (mode !== 'free' || !freeView || currentIdx < 0) return;
    const [sx, sy] = toScreen(
      freeView,
      model.plane.xs[currentIdx],
      model.plane.ys[currentIdx],
    );
    if (sx >= 0 && sy >= 0 && sx <= size.width && sy <= size.height) return;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
    setFreeView({
      ...freeView,
      tx: freeView.tx + size.width / 2 - sx,
      ty: freeView.ty + size.height / 2 - sy,
    });
  }, [mode, freeView, currentIdx, model, size]);

  const changeView = useCallback((next: View) => {
    setMode('free');
    setFreeView(next);
  }, []);
  const zoomBy = (factor: number) => {
    if (!view) return;
    changeView(zoomAt(view, size.width / 2, size.height / 2, factor));
  };

  return (
    <div className='absolute bottom-2.5 left-2.5 z-[9] flex w-[330px] flex-col bg-white text-[#212529] shadow-[0_0.5rem_1rem_rgba(0,0,0,0.25)]'>
      <div className='flex items-center gap-1.5 border-b border-[#dee2e6] px-2 py-1 text-[11px]'>
        <span className='font-semibold tracking-wider text-[#6c757d] uppercase'>
          Survey position
        </span>
        <span className='min-w-0 truncate text-[#6c757d]'>
          {[transectNo != null ? `T${transectNo}` : '', positionLabel ?? '']
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className='ml-auto flex flex-none gap-0.5'>
          <MapButton title='Zoom in' onClick={() => zoomBy(1.5)}>
            <Plus className='size-3.5' />
          </MapButton>
          <MapButton title='Zoom out' onClick={() => zoomBy(1 / 1.5)}>
            <Minus className='size-3.5' />
          </MapButton>
          <MapButton
            title='Fit the current transect'
            active={mode === 'transect'}
            onClick={() => setMode('transect')}
          >
            <LocateFixed className='size-3.5' />
          </MapButton>
          <MapButton
            title='Fit the survey'
            active={mode === 'survey'}
            onClick={() => setMode('survey')}
          >
            <Maximize className='size-3.5' />
          </MapButton>
          <MapButton title='Close the larger map' onClick={onClose}>
            <Minimize2 className='size-3.5' />
          </MapButton>
        </span>
      </div>
      <MinimapCanvas
        model={model}
        view={view}
        onViewChange={changeView}
        theme='light'
        inFilter={inFilter}
        viewed={viewed}
        currentIdx={currentIdx}
        hintFor={hintFor}
        onSelect={onSelect}
        onSize={setSize}
        className='h-[198px]'
      />
      <div className='border-t border-[#dee2e6] px-2 py-1'>
        <Legend theme='light' />
      </div>
    </div>
  );
}

function MapButton({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex size-6 items-center justify-center border border-[#dee2e6] hover:bg-[#f1f3f5]',
        active && 'bg-[#e9ecef]',
      )}
    >
      {children}
    </button>
  );
}
