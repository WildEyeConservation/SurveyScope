import { LEGACY_STORMFLY_BOX_SIZE } from '../useLaunchTask';
import type { DataClient } from '../../amplify/shared/data-schema.generated';

// Level is absolute; offset is steps in from a whole-image fit.
export type ZoomPreviewMode = 'level' | 'offset';

export type ZoomPreviewCandidate = {
  id: string;
  imageId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export const ZOOM_LEVEL_COUNT = 13;
export const DEFAULT_ZOOM_OFFSET = 6;

const SAMPLE_POOL_SIZE = 50;

export function pickZoomPreviewCandidates<T>(items: T[]): T[] {
  const picked = [...items];
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked.slice(0, SAMPLE_POOL_SIZE);
}

export async function loadLocationCandidates(
  client: DataClient,
  locationSetIds: string[],
  confidence?: { lower: number; upper: number }
): Promise<ZoomPreviewCandidate[]> {
  const pages = await Promise.all(
    locationSetIds.map((setId) =>
      client.models.Location.locationsBySetIdAndConfidence(
        confidence
          ? {
              setId,
              confidence: { between: [confidence.lower, confidence.upper] },
            }
          : { setId },
        {
          sortDirection: 'DESC',
          limit: SAMPLE_POOL_SIZE,
          selectionSet: [
            'id',
            'x',
            'y',
            'width',
            'height',
            'imageId',
            'source',
          ] as const,
        }
      )
    )
  );
  const found: ZoomPreviewCandidate[] = [];
  for (const loc of pages.flatMap((page) => page.data ?? [])) {
    if (!loc.imageId) continue;
    if (!Number.isFinite(loc.x) || !Number.isFinite(loc.y)) continue;
    const fallback =
      loc.source === 'stormfly-testing' ? LEGACY_STORMFLY_BOX_SIZE : 0;
    const width = loc.width && loc.width > 0 ? loc.width : fallback;
    const height = loc.height && loc.height > 0 ? loc.height : fallback;
    if (width <= 0 || height <= 0) continue;
    found.push({
      id: loc.id,
      imageId: loc.imageId,
      x: loc.x,
      y: loc.y,
      width,
      height,
    });
  }
  return pickZoomPreviewCandidates(found);
}
