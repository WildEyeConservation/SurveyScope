import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Maximize2Icon, RotateCcwIcon, ShuffleIcon, XIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { MAP_CONTROLS } from '../mapTheme';
import { type ImageOrientationGroup } from '../../types/Orientation';

// Each camera is split strictly by the source image's displayed dimensions.
// Landscape and portrait images can therefore receive independent physical
// corrections while every image within a camera+shape group stays consistent.
export interface OrientationCameraGroup {
  cameraName: string;
  orientationGroup: ImageOrientationGroup;
  files: File[];
}

// The full-size viewer covers the step it was opened from, not the page.
const ViewerHostContext = createContext<{
  host: HTMLElement | null;
  setOpen: (open: boolean) => void;
}>({ host: null, setOpen: () => {} });

export function SampleViewerArea({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <ViewerHostContext.Provider value={{ host, setOpen }}>
      <div className={cn('relative', open && 'min-h-[34rem]')}>
        {children}
        <div ref={setHost} className={open ? 'absolute inset-0 z-20' : 'hidden'} />
      </div>
    </ViewerHostContext.Provider>
  );
}

function SampleButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      title={title}
      disabled={disabled}
      onClick={onClick}
      className='flex h-7 flex-1 items-center justify-center gap-1 border-l border-black/10 text-xs text-[#212529] first:border-l-0 enabled:hover:bg-black/10 disabled:opacity-50'
    >
      {children}
    </button>
  );
}

function ViewerButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className='flex h-8 items-center gap-1.5 border-l border-black/10 px-3 text-sm text-[#212529] first:border-l-0 hover:bg-black/10'
    >
      {children}
    </button>
  );
}

function ExpandedSample({
  url,
  title,
  rotation,
  onRotate,
  onNextSample,
  onClose,
}: {
  url: string;
  title: string;
  rotation: number;
  onRotate: () => void;
  onNextSample?: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const quarterTurn = rotation % 180 !== 0;
  const { host, setOpen } = useContext(ViewerHostContext);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setOpen(true);
    return () => setOpen(false);
  }, [setOpen]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setStage({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => setView({ scale: 1, x: 0, y: 0 }), [url]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    setView((prev) => {
      const scale = Math.min(
        Math.max(prev.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2), 1),
        20
      );
      if (scale === 1) return { scale, x: 0, y: 0 };
      const ratio = scale / prev.scale;
      // Keep the point under the cursor fixed.
      return {
        scale,
        x: cx - (cx - prev.x) * ratio,
        y: cy - (cy - prev.y) * ratio,
      };
    });
  };

  return createPortal(
    <div className='absolute inset-0 flex flex-col border border-white/20 bg-card text-foreground shadow-lg'>
      <div className='flex items-center gap-3 border-b border-white/15 px-3 py-2'>
        <strong className='min-w-0 flex-1 truncate'>{title}</strong>
        <span className='hidden text-xs text-muted-foreground md:inline'>
          Scroll to zoom, drag to pan
        </span>
        <div className={cn('flex', MAP_CONTROLS)}>
          <ViewerButton onClick={onRotate}>
            <RotateCcwIcon className='size-4' />
            Rotate
          </ViewerButton>
          {onNextSample && (
            <ViewerButton onClick={onNextSample}>
              <ShuffleIcon className='size-4' />
              Another sample
            </ViewerButton>
          )}
          <ViewerButton onClick={onClose} label='Close'>
            <XIcon className='size-4' />
          </ViewerButton>
        </div>
      </div>
      <div
        ref={stageRef}
        onWheel={handleWheel}
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const last = dragRef.current;
          if (!last) return;
          dragRef.current = { x: e.clientX, y: e.clientY };
          setView((prev) => ({
            ...prev,
            x: prev.x + e.clientX - last.x,
            y: prev.y + e.clientY - last.y,
          }));
        }}
        onPointerUp={() => (dragRef.current = null)}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'grab',
          touchAction: 'none',
          background: 'rgba(0,0,0,0.25)',
        }}
      >
        <img
          src={url}
          alt={title}
          draggable={false}
          style={{
            // A quarter turn swaps which side of the stage limits the image.
            maxWidth: quarterTurn ? stage.height : stage.width,
            maxHeight: quarterTurn ? stage.width : stage.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${
              view.scale
            }) rotate(${-rotation}deg)`,
            userSelect: 'none',
          }}
        />
      </div>
    </div>,
    host ?? document.body
  );
}

export function OrientationSample({
  group,
  rotation,
  onRotate,
}: {
  group: OrientationCameraGroup;
  rotation: number;
  onRotate: () => void;
}) {
  // Start from the middle of the flight rather than the first frame, which is
  // often a ground/calibration shot; "Another sample" strides through the set.
  const [sampleIdx, setSampleIdx] = useState(() =>
    Math.floor(group.files.length / 2)
  );
  const file = group.files[Math.min(sampleIdx, group.files.length - 1)];
  const [url, setUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const nextSample = () => {
    const stride = Math.max(1, Math.floor(group.files.length / 7));
    setSampleIdx((prev) => (prev + stride) % group.files.length);
  };

  const label = group.orientationGroup === 'portrait' ? 'Portrait' : 'Landscape';

  return (
    <figure className='m-0 flex w-36 shrink-0 flex-col gap-1.5'>
      <div className='relative flex size-36 items-center justify-center overflow-hidden bg-black/30'>
        {url ? (
          <button
            type='button'
            aria-label={`Enlarge the ${label.toLowerCase()} sample`}
            onClick={() => setExpanded(true)}
            className='group flex size-full cursor-zoom-in items-center justify-center'
          >
            <img
              src={url}
              alt={file?.webkitRelativePath || group.cameraName}
              className='max-h-full max-w-full object-contain'
              style={{
                // CSS rotate() is clockwise; the stored correction is CCW.
                transform: `rotate(${-rotation}deg)`,
                transition: 'transform 0.2s ease',
              }}
            />
            <span className='absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100'>
              <Maximize2Icon className='size-5' />
              Enlarge
            </span>
          </button>
        ) : (
          <Spinner animation='border' size='sm' />
        )}
        {rotation !== 0 && (
          <span className='pointer-events-none absolute left-1.5 top-1.5 bg-primary px-1.5 text-[11px] leading-5 text-white'>
            Rotated {rotation}°
          </span>
        )}
      </div>
      <div className={cn('flex', MAP_CONTROLS)}>
        <SampleButton onClick={onRotate} title='Rotate 90° counter-clockwise'>
          <RotateCcwIcon className='size-3.5' />
          Rotate
        </SampleButton>
        <SampleButton onClick={() => setExpanded(true)} disabled={!url}>
          <Maximize2Icon className='size-3.5' />
          Enlarge
        </SampleButton>
      </div>
      {expanded && url && (
        <ExpandedSample
          url={url}
          title={`${group.cameraName} · ${label} · ${file?.webkitRelativePath ?? ''}`}
          rotation={rotation}
          onRotate={onRotate}
          onNextSample={group.files.length > 1 ? nextSample : undefined}
          onClose={() => setExpanded(false)}
        />
      )}
    </figure>
  );
}
