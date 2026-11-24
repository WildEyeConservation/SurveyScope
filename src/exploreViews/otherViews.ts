export type Pt = { x: number; y: number };
export type Size = { width: number; height: number };

export type NeighbourRow = {
  image1Id: string;
  image2Id: string;
  homography?: (number | null)[] | null;
};

// A neighbour that covers the point; `point` is null without a registration.
export type NearbyView = { imageId: string; point: Pt | null };

export function applyHomography(
  h: readonly number[],
  x: number,
  y: number,
): Pt | null {
  const w = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  const px = (h[0] * x + h[1] * y + h[2]) / w;
  const py = (h[3] * x + h[4] * y + h[5]) / w;
  return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
}

export function invertHomography(h: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, k, i] = h;
  const A = e * i - f * k;
  const B = -(d * i - f * g);
  const C = d * k - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det,
    -(b * i - c * k) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * k - b * g) / det,
    (a * e - b * d) / det,
  ];
}

export function validHomography(
  h: NeighbourRow['homography'],
): number[] | null {
  if (!h || h.length !== 9) return null;
  return h.every((v) => typeof v === 'number' && Number.isFinite(v))
    ? (h as number[])
    : null;
}

// Stored homographies map image1 pixels to image2 pixels.
export function nearbyViews(
  imageId: string,
  point: Pt,
  neighbours: NeighbourRow[],
  sizeOf: (imageId: string) => Size | undefined,
): NearbyView[] {
  const out = new Map<string, NearbyView>();
  for (const n of neighbours) {
    const forward = n.image1Id === imageId;
    if (!forward && n.image2Id !== imageId) continue;
    const other = forward ? n.image2Id : n.image1Id;
    if (other === imageId) continue;
    const h = validHomography(n.homography);
    const m = h && (forward ? h : invertHomography(h));
    if (!m) {
      if (!out.has(other)) out.set(other, { imageId: other, point: null });
      continue;
    }
    const p = applyHomography(m, point.x, point.y);
    const size = sizeOf(other);
    if (!p || !size) continue;
    if (p.x < 0 || p.y < 0 || p.x >= size.width || p.y >= size.height) {
      if (out.get(other)?.point === null) out.delete(other);
      continue;
    }
    out.set(other, { imageId: other, point: p });
  }
  return [...out.values()];
}

export function chainOtherCount(
  annotations: { id: string; objectId?: string | null }[],
  objectId: string | null | undefined,
  selfId: string,
): number {
  if (!objectId) return 0;
  let count = 0;
  for (const a of annotations)
    if (a.objectId === objectId && a.id !== selfId) count++;
  return count;
}

export function timeOffsetLabel(
  seconds: number | null | undefined,
  here: boolean,
): string {
  if (here) return 'This image';
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  if (s === 0) return '0 s';
  const sign = s > 0 ? '+' : '−';
  const abs = Math.abs(s);
  return abs < 60
    ? `${sign}${abs} s`
    : `${sign}${Math.floor(abs / 60)} m ${abs % 60} s`;
}
