export type MaskShape = 'landscape' | 'portrait';

/** Vertices as fractions of the stored image; y is measured from the top. */
export type MaskPolygon = [number, number][];

/** Keyed by the shape of the stored (orientation-corrected) image. */
export type CameraMasks = Partial<Record<MaskShape, MaskPolygon[]>>;

const SHAPES: MaskShape[] = ['landscape', 'portrait'];

const isPolygon = (value: unknown): value is MaskPolygon =>
  Array.isArray(value) &&
  value.length >= 3 &&
  value.every(
    (vertex) =>
      Array.isArray(vertex) &&
      vertex.length === 2 &&
      vertex.every((n) => typeof n === 'number' && Number.isFinite(n))
  );

export function parseCameraMasks(raw: unknown): CameraMasks {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object') return {};
  const result: CameraMasks = {};
  for (const shape of SHAPES) {
    const polygons = (value as Record<string, unknown>)[shape];
    if (!Array.isArray(polygons)) continue;
    const valid = polygons.filter(isPolygon);
    if (valid.length > 0) result[shape] = valid;
  }
  return result;
}

export function serializeCameraMasks(
  masks: CameraMasks | undefined
): string | null {
  const cleaned = parseCameraMasks(masks);
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

export function countMaskRegions(masks: CameraMasks | undefined): number {
  return SHAPES.reduce(
    (total, shape) => total + (masks?.[shape]?.length ?? 0),
    0
  );
}

function polygonContains(polygon: MaskPolygon, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** x/y in pixels of an image with the given stored dimensions. */
export function isPointMasked(
  masks: CameraMasks | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  if (!masks || width <= 0 || height <= 0) return false;
  const polygons = masks[height > width ? 'portrait' : 'landscape'];
  if (!polygons?.length) return false;
  return polygons.some((polygon) =>
    polygonContains(polygon, x / width, y / height)
  );
}

export function pairCameraMasks(
  cameraIds: (string | null | undefined)[],
  masksByCameraId: Map<string, CameraMasks>
): (CameraMasks | null)[] | undefined {
  const pair = cameraIds.map(
    (cameraId) => (cameraId && masksByCameraId.get(cameraId)) || null
  );
  return pair.some(Boolean) ? pair : undefined;
}
