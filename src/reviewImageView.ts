import { prefetchTask } from './annotator/prefetchTask';

// With this scale the location box is exactly the area shown.
export const VIEW_BOUNDS_SCALE = 0.5;

export type Point = { x: number; y: number };

export type ViewerImage = {
  id: string;
  width?: number | null;
  height?: number | null;
  boundaryStatus?: string | null;
  originalPath?: string | null;
  timestamp?: number | null;
};

export type ViewerCount = {
  key: string;
  label: string;
  color: string;
  count: number;
};

type Client = Parameters<typeof prefetchTask>[0];

export const fileName = (path: string | null | undefined, id: string) =>
  path?.split(/[\\/]/).pop() || id;

export const formatTime = (timestamp: number | null | undefined) =>
  timestamp ? new Date(timestamp * 1000).toLocaleTimeString() : '';

// Frames the image's sightings, so the first tiles fetched are the ones shown.
export function viewBox(
  image: { width: number; height: number },
  points: Point[],
) {
  if (points.length === 0)
    return {
      x: image.width / 2,
      y: image.height / 2,
      width: image.width,
      height: image.height,
    };
  const minSide = Math.min(image.width, image.height) / 4;
  const axis = (values: number[]) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    return { mid: (lo + hi) / 2, size: Math.max(hi - lo, minSide) * 1.2 };
  };
  const xs = axis(points.map((p) => p.x));
  const ys = axis(points.map((p) => p.y));
  return { x: xs.mid, y: ys.mid, width: xs.size, height: ys.size };
}

export function warmImage(
  client: unknown,
  image: ViewerImage,
  points: Point[],
  signal: AbortSignal,
  viewport?: { width: number; height: number },
) {
  if (!image.width || !image.height) return;
  const size = { width: image.width, height: image.height };
  void prefetchTask(
    client as Client,
    {
      location: { image: { id: image.id, ...size }, ...viewBox(size, points) },
      viewBoundsScale: VIEW_BOUNDS_SCALE,
      viewport,
    },
    signal,
  );
}
