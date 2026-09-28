import {
  annotationTiles,
  baseTiles,
  getPyramidInfo,
  type Tile,
  type TilePoint,
} from './tiles';
import type { TileContext } from '../../StorageLayer';
import { preparedTileKey } from './preparedTileCache';

export interface TilePreloadPlan {
  context: TileContext;
  sourceKey: string;
  points: ReadonlyArray<TilePoint>;
}

interface PreloadJob {
  context: TileContext;
  sourceKey: string;
  tile: Tile;
  maxZ: number;
}

export async function preloadTiles(
  plans: ReadonlyArray<TilePreloadPlan>,
  prepareTile: (
    context: TileContext,
    sourceKey: string,
    tile: Tile,
    maxZ: number
  ) => Promise<unknown>,
  cancelled: () => boolean
): Promise<void> {
  const jobs = new Map<string, PreloadJob>();
  const add = (job: PreloadJob) => {
    jobs.set(
      preparedTileKey(job.context, job.sourceKey, job.tile, job.maxZ),
      job
    );
  };
  const queues = plans.map(({ context, sourceKey, points }) => {
    const { width, height } = context;
    const { maxZ } = getPyramidInfo({ width, height });
    for (const tile of baseTiles(width, height))
      add({ context, sourceKey, tile, maxZ });
    return annotationTiles(width, height, points).map((tile) => ({
      context,
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
      const { context, sourceKey, tile, maxZ } = requests[next++];
      try {
        await prepareTile(context, sourceKey, tile, maxZ);
      } catch {
        // Foreground loading retries.
      }
    }
  };
  // Two workers keep background traffic light.
  await Promise.all([worker(), worker()]);
}
