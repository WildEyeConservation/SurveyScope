export interface ImageProjection {
  px2lngLat: (x: number, y: number) => [number, number];
  lngLat2px: (lng: number, lat: number) => { x: number; y: number };
  maxNativeZoom: number;
  /** Side of the pyramid's power-of-two square, in image pixels. */
  size: number;
}

/** Pixel <-> LngLat mapping that places the pyramid's power-of-two square
 * exactly over the mercator world, so tile (z, x, y) == pyramid tile. */
export function makeProjection(width: number, height: number): ImageProjection {
  const n = Math.pow(2, Math.ceil(Math.log2(Math.max(width, height))));
  const px2lngLat = (x: number, y: number): [number, number] => {
    const lng = (x / n) * 360 - 180;
    const t = y / n; // 0 = top edge of the pyramid square
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * 180) / Math.PI;
    return [lng, lat];
  };
  const lngLat2px = (lng: number, lat: number): { x: number; y: number } => {
    const x = ((lng + 180) / 360) * n;
    const rad = (lat * Math.PI) / 180;
    const t = (1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2;
    return { x, y: t * n };
  };
  const maxNativeZoom = Math.max(
    0,
    Math.ceil(Math.log2(Math.max(width, height))) - 8
  );
  return { px2lngLat, lngLat2px, maxNativeZoom, size: n };
}

const WORLD_SIZE_AT_ZOOM_0 = 512;

// fitBounds clamps corners at the mercator latitude limits, shifting the centre.
export function pxBoundsCamera(
  projection: ImageProjection,
  viewport: { width: number; height: number },
  left: number,
  top: number,
  right: number,
  bottom: number
): { center: [number, number]; zoom: number } | null {
  const scale = Math.min(
    viewport.width / (right - left),
    viewport.height / (bottom - top)
  );
  const zoom = Math.log2((scale * projection.size) / WORLD_SIZE_AT_ZOOM_0);
  if (!Number.isFinite(zoom)) return null;
  return {
    center: projection.px2lngLat((left + right) / 2, (top + bottom) / 2),
    zoom,
  };
}
