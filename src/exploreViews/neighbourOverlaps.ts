import {
  applyHomography,
  invertHomography,
  validHomography,
  type NeighbourRow,
  type Pt,
  type Size,
} from './otherViews';

export type Segment = [Pt, Pt];

export type NeighbourOverlap = {
  imageId: string;
  area: Pt[];
  edges: Segment[];
  grid: Segment[];
  labelAt: Pt;
};

export const OVERLAP_COLOURS = [
  '#00e5ff',
  '#ffe14d',
  '#ff4fd8',
  '#7dff5a',
  '#ff8c1a',
  '#b69cff',
  '#ff5c5c',
  '#ffffff',
];

const GRID_DIVISIONS = 8;

// Stored homographies map image1 pixels to image2 pixels.
export function neighbourToImage(
  imageId: string,
  row: NeighbourRow,
): { imageId: string; matrix: number[] } | null {
  const isImage2 = row.image2Id === imageId;
  if (!isImage2 && row.image1Id !== imageId) return null;
  const other = isImage2 ? row.image1Id : row.image2Id;
  if (other === imageId) return null;
  const h = validHomography(row.homography);
  const matrix = h && (isImage2 ? h : invertHomography(h));
  return matrix ? { imageId: other, matrix } : null;
}

export function projectCorners(m: readonly number[], size: Size): Pt[] | null {
  const corners = [
    [0, 0],
    [size.width, 0],
    [size.width, size.height],
    [0, size.height],
  ];
  const w = corners.map(([x, y]) => m[6] * x + m[7] * y + m[8]);
  if (!w.every((v) => v > 0) && !w.every((v) => v < 0)) return null;
  const out: Pt[] = [];
  for (const [x, y] of corners) {
    const p = applyHomography(m, x, y);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

const insideTests = (size: Size): ((p: Pt) => number)[] => [
  (p) => p.x,
  (p) => size.width - p.x,
  (p) => p.y,
  (p) => size.height - p.y,
];

export function clipPolygon(poly: Pt[], size: Size): Pt[] {
  let out = poly;
  for (const f of insideTests(size)) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i];
      const b = input[(i + 1) % input.length];
      const fa = f(a);
      const fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) {
        const t = fa / (fa - fb);
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    if (!out.length) return [];
  }
  return out;
}

export function clipSegment(a: Pt, b: Pt, size: Size): Segment | null {
  let t0 = 0;
  let t1 = 1;
  for (const f of insideTests(size)) {
    const fa = f(a);
    const fb = f(b);
    if (fa < 0 && fb < 0) return null;
    if (fa < 0) t0 = Math.max(t0, fa / (fa - fb));
    else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb));
  }
  if (t1 - t0 < 1e-9) return null;
  const at = (t: number) => ({
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  });
  return [at(t0), at(t1)];
}

export function polygonArea(poly: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonCentroid(poly: Pt[]): Pt {
  const area = polygonArea(poly);
  if (Math.abs(area) < 1e-9) {
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function neighbourOverlaps(
  imageId: string,
  size: Size,
  rows: NeighbourRow[],
  sizeOf: (imageId: string) => Size | undefined,
): NeighbourOverlap[] {
  const out: NeighbourOverlap[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const t = neighbourToImage(imageId, row);
    if (!t || seen.has(t.imageId)) continue;
    const other = sizeOf(t.imageId);
    if (!other?.width || !other.height) continue;
    const corners = projectCorners(t.matrix, other);
    if (!corners) continue;
    const area = clipPolygon(corners, size);
    if (Math.abs(polygonArea(area)) < 1) continue;
    seen.add(t.imageId);
    const edges = corners
      .map((c, i) => clipSegment(c, corners[(i + 1) % 4], size))
      .filter((s): s is Segment => !!s);
    const grid: Segment[] = [];
    for (let i = 1; i < GRID_DIVISIONS; i++) {
      const x = (other.width * i) / GRID_DIVISIONS;
      const y = (other.height * i) / GRID_DIVISIONS;
      for (const [ax, ay, bx, by] of [
        [x, 0, x, other.height],
        [0, y, other.width, y],
      ]) {
        const a = applyHomography(t.matrix, ax, ay);
        const b = applyHomography(t.matrix, bx, by);
        const s = a && b && clipSegment(a, b, size);
        if (s) grid.push(s);
      }
    }
    out.push({
      imageId: t.imageId,
      area,
      edges,
      grid,
      labelAt: polygonCentroid(area),
    });
  }
  return out;
}

export function colourOverlaps<T extends { imageId: string }>(
  overlaps: T[],
  timestampOf: (imageId: string) => number | null | undefined,
): (T & { colour: string })[] {
  const time = (o: T) => timestampOf(o.imageId) ?? Infinity;
  return [...overlaps]
    .sort((a, b) => time(a) - time(b) || a.imageId.localeCompare(b.imageId))
    .map((o, i) => ({
      ...o,
      colour: OVERLAP_COLOURS[i % OVERLAP_COLOURS.length],
    }));
}
