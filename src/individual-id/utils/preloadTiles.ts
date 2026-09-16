import {
  annotationTiles,
  baseTiles,
  getPyramidInfo,
  type Tile,
  type TilePoint,
} from './tiles';
import { preparedTileKey } from './preparedTileCache';

export interface TilePreloadPlan {
  sourceKey: string;
  width: number;
  height: number;
  points: ReadonlyArray<TilePoint>;
}

export async function preloadTiles(
  plans: ReadonlyArray<TilePreloadPlan>,
  prepareTile: (
    sourceKey: string,
    tile: Tile,
    maxZ: number
  ) => Promise<unknown>,
  cancelled: () => boolean
): Promise<void> {
  const jobs = new Map<
    string,
    { sourceKey: string; tile: Tile; maxZ: number }
  >();
  const add = (job: { sourceKey: string; tile: Tile; maxZ: number }) => {
    jobs.set(preparedTileKey(job.sourceKey, job.tile, job.maxZ), job);
  };
  const queues = plans.map(({ sourceKey, width, height, points }) => {
    const { maxZ } = getPyramidInfo({ width, height });
    for (const tile of baseTiles(width, height)) add({ sourceKey, tile, maxZ });
    return annotationTiles(width, height, points).map((tile) => ({
      sourceKey,
      tile,
      maxZ,
    }));
  });
  for (let i = 0; queues.some((queue) => i < queue.length); i++) {
    for (const queue of queues) if (queue[i]) add(queue[i]);
  }
  const requests = [...jobs.values()];
  let next = 0;
  const worker = async () => {
    while (!cancelled() && next < requests.length) {
      const { sourceKey, tile, maxZ } = requests[next++];
      try {
        await prepareTile(sourceKey, tile, maxZ);
      } catch {
        // Foreground loading retries.
      }
    }
  };
  // Two workers keep background traffic light.
  await Promise.all([worker(), worker()]);
}
