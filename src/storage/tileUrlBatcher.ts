import {
  bufferedTiles,
  MAX_TILE_BATCH,
  tileId,
  validTile,
  type TileCoordinate,
} from '../../shared/imageTiles';
export interface TileContext {
  imageId: string;
  width: number;
  height: number;
  sharedImageId?: string;
}
export interface TileUrl {
  url: string;
  expiresAt: number;
}
export interface SignedTileBatch {
  expiresAt: number;
  tiles: (TileCoordinate & { url: string })[];
}
export type SignTiles = (
  context: TileContext,
  sourceKey: string,
  tiles: TileCoordinate[]
) => Promise<SignedTileBatch>;
type Deferred = {
  resolve: (value: TileUrl) => void;
  reject: (error: unknown) => void;
  promise: Promise<TileUrl>;
};
function deferred(): Deferred {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise<TileUrl>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // Buffer-only tiles may never have a consumer.
  void promise.catch(() => {});
  return { resolve, reject, promise };
}
export function tileImageKey(
  scope: string,
  context: TileContext,
  sourceKey: string
): string {
  return JSON.stringify([
    scope,
    context.imageId,
    context.sharedImageId ?? '',
    sourceKey,
  ]);
}

export class TileUrlBatcher {
  private cache = new Map<string, TileUrl>();
  private pending = new Map<string, Deferred>();
  private queues = new Map<
    string,
    {
      scope: string;
      context: TileContext;
      sourceKey: string;
      tiles: TileCoordinate[];
    }
  >();
  private generation = 0;

  constructor(private sign: SignTiles, private now = Date.now) {}

  private imageKey(scope: string, context: TileContext, sourceKey: string) {
    return tileImageKey(scope, context, sourceKey);
  }

  invalidate() {
    this.generation++;
    this.cache.clear();
    this.queues.clear();
    for (const entry of this.pending.values())
      entry.reject(new Error('Image session changed'));
    this.pending.clear();
  }
  evict(
    scope: string,
    context: TileContext,
    sourceKey: string,
    tile: TileCoordinate
  ) {
    this.cache.delete(
      `${this.imageKey(scope, context, sourceKey)}:${tileId(tile)}`
    );
  }
  get(
    scope: string,
    context: TileContext,
    sourceKey: string,
    tile: TileCoordinate
  ): Promise<TileUrl> {
    if (!validTile(tile, context))
      return Promise.reject(new Error('Tile outside image bounds'));
    const imageKey = this.imageKey(scope, context, sourceKey);
    const key = `${imageKey}:${tileId(tile)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now() + 60_000) {
      this.enqueue(imageKey, scope, context, sourceKey, tile);
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(key);
    if (existing) return existing.promise;
    const entry = deferred();
    this.pending.set(key, entry);
    this.enqueue(imageKey, scope, context, sourceKey, tile);
    return entry.promise;
  }
  private enqueue(
    imageKey: string,
    scope: string,
    context: TileContext,
    sourceKey: string,
    tile: TileCoordinate
  ) {
    let queue = this.queues.get(imageKey);
    if (!queue) {
      queue = { scope, context, sourceKey, tiles: [] };
      this.queues.set(imageKey, queue);
      setTimeout(() => {
        void this.flush(imageKey);
      }, 0);
    }
    queue.tiles.push(tile);
  }
  private async flush(imageKey: string) {
    const queue = this.queues.get(imageKey);
    if (!queue) return;
    this.queues.delete(imageKey);
    const generation = this.generation;
    const requested = new Set(queue.tiles.map(tileId));
    const tiles = bufferedTiles(queue.tiles, queue.context).filter((tile) => {
      const key = `${imageKey}:${tileId(tile)}`;
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > this.now() + 60_000) return false;
      if (this.pending.has(key) && !requested.has(tileId(tile))) return false;
      if (!this.pending.has(key)) this.pending.set(key, deferred());
      return true;
    });
    for (let i = 0; i < tiles.length; i += MAX_TILE_BATCH) {
      const chunk = tiles.slice(i, i + MAX_TILE_BATCH);
      try {
        if (generation !== this.generation) return;
        const batch = await this.sign(queue.context, queue.sourceKey, chunk);
        if (generation !== this.generation) return;
        const signed = new Map(batch.tiles.map((t) => [tileId(t), t.url]));
        for (const tile of chunk) {
          const key = `${imageKey}:${tileId(tile)}`;
          const entry = this.pending.get(key);
          this.pending.delete(key);
          const url = signed.get(tileId(tile));
          if (
            !url ||
            !Number.isFinite(batch.expiresAt) ||
            batch.expiresAt <= this.now()
          ) {
            entry?.reject(new Error('Missing or expired tile URL'));
            continue;
          }
          const value = { url, expiresAt: batch.expiresAt };
          this.cache.set(key, value);
          entry?.resolve(value);
        }
        // Bound memory when browsing thousands of images.
        while (this.cache.size > 8192)
          this.cache.delete(this.cache.keys().next().value!);
      } catch (error) {
        if (generation !== this.generation) return;
        for (const tile of chunk) {
          const key = `${imageKey}:${tileId(tile)}`;
          this.pending.get(key)?.reject(error);
          this.pending.delete(key);
        }
      }
    }
  }
}
