import type { TileCoordinate } from '../../shared/imageTiles';
import {
  openTilePack,
  TilePackRequestFailed,
  type TilePack,
  type TilePackAccess,
  type TilePackOptions,
} from './tilePackReader';

export class TilePackGone extends Error {}

// Only definite answers mean the image has no usable pack.
export const isPackGone = (error: unknown) =>
  error instanceof TilePackGone ||
  (error instanceof TilePackRequestFailed &&
    (error.status === 403 || error.status === 404));

export type OpenPack = { pack: TilePack; format: string };

export async function openSignedTilePack(
  sign: () => Promise<TilePackAccess | null>,
  size: { width: number; height: number },
  options: Pick<TilePackOptions, 'fetch' | 'limiter' | 'now'> = {}
): Promise<OpenPack | null> {
  const access = await sign();
  if (!access) return null;
  const pack = openTilePack({
    ...options,
    access,
    refresh: async () => {
      const next = await sign();
      if (!next) throw new TilePackGone('Tile pack no longer exists');
      return next;
    },
  });
  const { meta } = await pack.header();
  // A pack cut from different dimensions would misalign every tile.
  if (meta.width !== size.width || meta.height !== size.height) return null;
  return { pack, format: meta.format };
}

export class TilePackRegistry {
  private packs = new Map<string, Promise<OpenPack | null>>();
  private missing = new Map<string, number>();

  constructor(
    private capacity = 32,
    private missingMs = 60_000,
    private now = Date.now
  ) {}

  get(
    imageKey: string,
    open: () => Promise<OpenPack | null>
  ): Promise<OpenPack | null> {
    if ((this.missing.get(imageKey) ?? 0) > this.now())
      return Promise.resolve(null);
    this.missing.delete(imageKey);
    let entry = this.packs.get(imageKey);
    if (!entry) {
      const loading = open().catch((error: unknown) => {
        if (isPackGone(error)) return null;
        throw error;
      });
      entry = loading;
      loading.then(
        (pack) => {
          if (!pack && this.packs.get(imageKey) === loading)
            this.forget(imageKey);
        },
        () => {
          if (this.packs.get(imageKey) === loading) this.packs.delete(imageKey);
        }
      );
    }
    this.packs.delete(imageKey);
    this.packs.set(imageKey, entry);
    for (const oldest of this.packs.keys()) {
      if (this.packs.size <= this.capacity) break;
      this.packs.delete(oldest);
    }
    return entry;
  }

  forget(imageKey: string) {
    this.packs.delete(imageKey);
    this.missing.set(imageKey, this.now() + this.missingMs);
  }

  clear() {
    this.packs.clear();
    this.missing.clear();
  }
}

export async function loadPackTile(ops: {
  tile: TileCoordinate;
  open: () => Promise<OpenPack | null>;
  forget: () => void;
  legacy: () => Promise<Blob>;
  readCache: () => Promise<Blob | null>;
  writeCache: (blob: Blob) => Promise<unknown>;
  assertCurrentSession: () => void;
}): Promise<Blob> {
  const open = await ops.open();
  ops.assertCurrentSession();
  if (!open) return ops.legacy();
  try {
    // Cached bytes are only served while access to the pack is authorized.
    await open.pack.authorize();
    ops.assertCurrentSession();
    const cached = await ops.readCache();
    ops.assertCurrentSession();
    if (cached) return cached;
    const { z, row, col } = ops.tile;
    const bytes = await open.pack.tile(z, row, col);
    ops.assertCurrentSession();
    const blob = new Blob([bytes], { type: open.format });
    await ops.writeCache(blob);
    ops.assertCurrentSession();
    return blob;
  } catch (error) {
    if (!isPackGone(error)) throw error;
    ops.forget();
    return ops.legacy();
  }
}
