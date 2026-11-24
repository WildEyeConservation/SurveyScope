import { makeProjection } from '../annotator/imageProjection';

const WORLD_SIZE_AT_ZOOM_0 = 512;

// Screen pixels per image pixel, so images of different sizes match.
export function scaleFromZoom(zoom: number, width: number, height: number) {
  return (
    (WORLD_SIZE_AT_ZOOM_0 * 2 ** zoom) / makeProjection(width, height).size
  );
}

export function zoomFromScale(scale: number, width: number, height: number) {
  return Math.log2(
    (scale * makeProjection(width, height).size) / WORLD_SIZE_AT_ZOOM_0,
  );
}

export function targetZoom(
  image: { width: number; height: number },
  scale: number | null,
  storedDefaultZoom: number | null,
): number | null {
  if (scale != null && scale > 0) {
    return zoomFromScale(scale, image.width, image.height);
  }
  // Stored defaults use the image pyramid's levels, one above MapLibre's.
  if (storedDefaultZoom != null) return storedDefaultZoom - 1;
  return null;
}

let current: { owner: object; scale: number } | null = null;

export function reportViewerZoom(
  owner: object,
  zoom: number,
  image: { width: number; height: number },
) {
  const scale = scaleFromZoom(zoom, image.width, image.height);
  if (Number.isFinite(scale) && scale > 0) current = { owner, scale };
}

export function clearViewerZoom(owner: object) {
  if (current?.owner === owner) current = null;
}

export const viewerScale = () => current?.scale ?? null;
