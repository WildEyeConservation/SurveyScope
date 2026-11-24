import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { NotebookCrop } from './types';

const MIN_SCALE = 0.25;
const MAX_SCALE = 16;
const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

type View = { scale: number; x: number; y: number };

async function draw(canvas: HTMLCanvasElement, crop: NotebookCrop) {
  const bitmaps = await Promise.all(
    crop.tiles.map(async (tile) => {
      const bytes = Uint8Array.from(atob(tile.data), (c) => c.charCodeAt(0));
      return {
        tile,
        bitmap: await createImageBitmap(new Blob([bytes], { type: tile.type })),
      };
    }),
  );
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  for (const { tile, bitmap } of bitmaps) {
    context.drawImage(bitmap, tile.left, tile.top, tile.size, tile.size);
    bitmap.close();
  }
}

function useSize(element: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

// A small still around one example, zoomable with the wheel, drag or +/-.
export function CropView({
  crop,
  color,
  scale,
  onScale,
  zoomKey,
}: {
  crop: NotebookCrop;
  color: string;
  // Screen pixels per image pixel, carried over from the annotator.
  scale: number | null;
  onScale: (scale: number) => void;
  zoomKey: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const size = useSize(box);
  const [view, setView] = useState<View | null>(null);
  const viewRef = useRef<View | null>(null);
  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const show = (next: View) => {
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    if (!canvasRef.current) return;
    setFailed(false);
    draw(canvasRef.current, crop).catch(() => setFailed(true));
  }, [crop]);

  // Each example opens with the point centred.
  useEffect(() => {
    if (!size.width || !size.height) return;
    const fit = Math.min(size.width / crop.width, size.height / crop.height);
    const s = clampScale(scale ?? fit);
    show({
      scale: s,
      x: size.width / 2 - crop.point.x * s,
      y: size.height / 2 - crop.point.y * s,
    });
    // Only a new example or panel size reframes; zooming keeps the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crop, size.width, size.height]);

  const zoomAt = (factor: number, at: { x: number; y: number }) => {
    const v = viewRef.current;
    if (!v) return;
    const s = clampScale(v.scale * factor);
    show({
      scale: s,
      x: at.x - (at.x - v.x) * (s / v.scale),
      y: at.y - (at.y - v.y) * (s / v.scale),
    });
    onScaleRef.current(s);
  };

  const lastKey = useRef(zoomKey);
  useEffect(() => {
    if (zoomKey === lastKey.current) return;
    const factor = zoomKey > lastKey.current ? 1.25 : 0.8;
    lastKey.current = zoomKey;
    zoomAt(factor, { x: size.width / 2, y: size.height / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomKey]);

  useEffect(() => {
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box]);

  return (
    <div
      ref={setBox}
      className='absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing'
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        const v = viewRef.current;
        if (!from || !v) return;
        drag.current = { x: event.clientX, y: event.clientY };
        show({
          ...v,
          x: v.x + event.clientX - from.x,
          y: v.y + event.clientY - from.y,
        });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {failed && (
        <div className='absolute inset-0 flex items-center justify-center text-sm text-[#bcccdc]'>
          This image is unavailable.
        </div>
      )}
      <div
        className='absolute top-0 left-0 origin-top-left'
        style={{
          visibility: view ? 'visible' : 'hidden',
          transform: view
            ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
            : undefined,
        }}
      >
        <canvas
          ref={canvasRef}
          className='block'
          style={{
            imageRendering:
              view && view.scale >= 2 ? 'pixelated' : ('auto' as const),
          }}
        />
        <span
          className='pointer-events-none absolute rounded-full border-2'
          style={{
            borderColor: color,
            left: crop.point.x,
            top: crop.point.y,
            width: 28 / (view?.scale ?? 1),
            height: 28 / (view?.scale ?? 1),
            borderWidth: 2 / (view?.scale ?? 1),
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>
    </div>
  );
}
