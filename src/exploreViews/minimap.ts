export type View = { scale: number; tx: number; ty: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Plane = { xs: Float64Array; ys: Float64Array };

// North-up equirectangular plane; y grows southwards like the canvas.
export function toPlane(
  lats: ArrayLike<number>,
  lngs: ArrayLike<number>,
  cosLat: number,
): Plane {
  const xs = new Float64Array(lats.length);
  const ys = new Float64Array(lats.length);
  for (let i = 0; i < lats.length; i++) {
    xs[i] = lngs[i] * cosLat;
    ys[i] = -lats[i];
  }
  return { xs, ys };
}

export function meanCosLat(lats: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < lats.length; i++)
    if (Number.isFinite(lats[i])) {
      sum += lats[i];
      n++;
    }
  return Math.cos(((n ? sum / n : 0) * Math.PI) / 180);
}

// Survey outlines are stored as flat [lat, lng, lat, lng, ...] lists.
export function ringToPlane(
  coords: (number | null)[] | null | undefined,
  cosLat: number,
): [number, number][] | null {
  if (!coords || coords.length < 6) return null;
  const ring: [number, number][] = [];
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const lat = coords[i];
    const lng = coords[i + 1];
    if (lat == null || lng == null) continue;
    ring.push([lng * cosLat, -lat]);
  }
  return ring.length >= 3 ? ring : null;
}

export function extendBounds(
  b: Bounds | null,
  x: number,
  y: number,
): Bounds | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return b;
  if (!b) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(b.minX, x),
    minY: Math.min(b.minY, y),
    maxX: Math.max(b.maxX, x),
    maxY: Math.max(b.maxY, y),
  };
}

export function boundsOf(
  plane: Plane,
  indices?: Iterable<number>,
  rings: [number, number][][] = [],
): Bounds | null {
  let b: Bounds | null = null;
  const all = indices ?? plane.xs.keys();
  for (const i of all) b = extendBounds(b, plane.xs[i], plane.ys[i]);
  for (const ring of rings)
    for (const [x, y] of ring) b = extendBounds(b, x, y);
  return b;
}

export function fitView(
  b: Bounds,
  width: number,
  height: number,
  pad: number,
  minSpan = 0,
): View {
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const spanX = Math.max(b.maxX - b.minX, minSpan, 1e-12);
  const spanY = Math.max(b.maxY - b.minY, minSpan, 1e-12);
  const scale = Math.min(
    Math.max(width - 2 * pad, 1) / spanX,
    Math.max(height - 2 * pad, 1) / spanY,
  );
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 - cy * scale };
}

export const toScreen = (v: View, x: number, y: number): [number, number] => [
  x * v.scale + v.tx,
  y * v.scale + v.ty,
];

export const fromScreen = (
  v: View,
  sx: number,
  sy: number,
): [number, number] => [(sx - v.tx) / v.scale, (sy - v.ty) / v.scale];

// Keeps the plane point under (sx, sy) fixed while zooming.
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const scale = v.scale * factor;
  return {
    scale,
    tx: sx - (sx - v.tx) * factor,
    ty: sy - (sy - v.ty) * factor,
  };
}

export function nearestWithin(
  plane: Plane,
  candidates: Iterable<number>,
  v: View,
  sx: number,
  sy: number,
  maxPx: number,
): number {
  const [px, py] = fromScreen(v, sx, sy);
  const max = maxPx / v.scale;
  let best = -1;
  let bestD = max * max;
  for (const i of candidates) {
    const dx = plane.xs[i] - px;
    const dy = plane.ys[i] - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function flightDirection(
  plane: Plane,
  prev: number,
  at: number,
  next: number,
): [number, number] | null {
  const from = prev >= 0 ? prev : at;
  const to = next >= 0 ? next : at;
  if (from === to) return null;
  const dx = plane.xs[to] - plane.xs[from];
  const dy = plane.ys[to] - plane.ys[from];
  const len = Math.hypot(dx, dy);
  return len > 0 ? [dx / len, dy / len] : null;
}
