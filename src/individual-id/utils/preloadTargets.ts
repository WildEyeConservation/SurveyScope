import { adjacentPairIndices, TILE_SIZE, type TilePoint } from './tiles';

export interface ZoomRingPreloadTarget {
  image: {
    id: string;
    originalPath?: string | null;
    width: number;
    height: number;
  };
  points: TilePoint[];
}

export function preloadPairIndices(
  entries: readonly number[],
  currentIndex: number,
  completionTarget?: number
) {
  return [
    ...new Set([
      completionTarget,
      ...adjacentPairIndices(entries, currentIndex),
    ]),
  ].filter(
    (index): index is number => index !== undefined && index !== currentIndex
  );
}

/** Snapped to tile cells so sub-tile drags do not restart preloading. */
export function serializePreloadTargets(
  targets: readonly ZoomRingPreloadTarget[]
): string {
  return JSON.stringify(
    targets.map(({ image, points }) => {
      const cells = new Map<string, TilePoint>();
      for (const point of points) {
        if (
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.y < 0 ||
          point.x >= image.width ||
          point.y >= image.height
        )
          continue;
        const x = Math.floor(point.x / TILE_SIZE) * TILE_SIZE;
        const y = Math.floor(point.y / TILE_SIZE) * TILE_SIZE;
        cells.set(`${x}/${y}`, { x, y });
      }
      return {
        image: {
          id: image.id,
          originalPath: image.originalPath,
          width: image.width,
          height: image.height,
        },
        points: [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x),
      };
    })
  );
}
