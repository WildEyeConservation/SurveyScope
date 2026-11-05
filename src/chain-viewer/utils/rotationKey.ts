import type { AnnotationImageMeta } from '../types';

/**
 * Per-camera rotation key for a tile. Falls back to a per-image key when the
 * image has no associated Camera row — keeps each unrelated image rotating
 * independently rather than lumping all camera-less images into one bucket.
 *
 * Shared by the grid and paginator tile views so a rotation applied in one
 * carries over to the other.
 */
export function rotationKeyFor(
  meta: AnnotationImageMeta | undefined,
  imageId: string,
): string {
  if (meta?.cameraId) return `cam:${meta.cameraId}`;
  return `img:${imageId}`;
}
