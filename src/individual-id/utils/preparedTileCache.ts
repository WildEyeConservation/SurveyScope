import type { TileContext } from '../../StorageLayer';
import { tileMaskKey, type Tile } from './tiles';

export function preparedTileKey(
  context: TileContext,
  sourceKey: string,
  tile: Tile,
  maxZ: number
) {
  return JSON.stringify([
    context.imageId,
    context.sharedImageId ?? '',
    sourceKey,
    maxZ,
    tile.z,
    tile.row,
    tile.col,
    tileMaskKey(tile),
  ]);
}

export function createPreparedTileCache(
  fetchTile: (path: string, context: TileContext) => Promise<Blob>,
  prepare: (blob: Blob, tile: Tile, maxZ: number) => Promise<Blob>,
  maxBytes = 64 * 1024 * 1024
) {
  const ready = new Map<string, Blob>();
  const pending = new Map<string, Promise<Blob>>();
  let bytes = 0;
  // Bumped by clear() so requests already in flight are not cached.
  let generation = 0;
  const get = (
    context: TileContext,
    sourceKey: string,
    tile: Tile,
    maxZ: number
  ): Promise<Blob> => {
    const key = preparedTileKey(context, sourceKey, tile, maxZ);
    const cached = ready.get(key);
    if (cached) {
      ready.delete(key);
      ready.set(key, cached);
      return Promise.resolve(cached);
    }
    const existing = pending.get(key);
    if (existing) return existing;
    const requestGeneration = generation;
    const request = Promise.resolve()
      .then(async () => {
        const path = `slippymaps/${sourceKey}/${tile.z}/${tile.row}/${tile.col}.png`;
        const blob = await prepare(await fetchTile(path, context), tile, maxZ);
        if (requestGeneration === generation && blob.size <= maxBytes) {
          ready.set(key, blob);
          bytes += blob.size;
          while (bytes > maxBytes) {
            const oldest = ready.keys().next().value!;
            bytes -= ready.get(oldest)!.size;
            ready.delete(oldest);
          }
        }
        return blob;
      })
      .finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
    pending.set(key, request);
    return request;
  };
  const clear = () => {
    generation++;
    ready.clear();
    pending.clear();
    bytes = 0;
  };
  return { get, clear };
}
