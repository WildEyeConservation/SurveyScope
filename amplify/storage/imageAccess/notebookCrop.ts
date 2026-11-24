import { selectSourceKeyForImage } from '../../../shared/imageSourceKey';
import { maxTileZoom, tileId } from '../../../shared/imageTiles';
import {
  cropTiles,
  cropWindow,
  type NotebookCrop,
  type NotebookCropTile,
} from '../../../shared/speciesNotebook';
import {
  decodeHeader,
  HEADER_GUESS_BYTES,
  tileIndex,
  tilePackKey,
} from '../../../shared/tilePack';
import {
  assertFileOwnership,
  authorizeProject,
  type ImageFileRow,
  type ImageRow,
  type ProjectRow,
  type StorageIdentity,
} from './authorization';

const TILE_SIZE = 256;

export interface CropSource {
  image(id: string): Promise<ImageRow | undefined>;
  project(id: string): Promise<ProjectRow | undefined>;
  files(imageId: string): Promise<ImageFileRow[]>;
  // Inclusive byte range of an output object, or null when it is missing.
  read(key: string, range?: [number, number]): Promise<Uint8Array | null>;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function fromPack(
  source: CropSource,
  sourceKey: string,
  crop: ReturnType<typeof cropWindow>
): Promise<NotebookCropTile[] | null> {
  const key = tilePackKey(sourceKey);
  let head = await source.read(key, [0, HEADER_GUESS_BYTES - 1]);
  if (!head) return null;
  let header = decodeHeader(head);
  if (!header.complete) {
    head = await source.read(key, [0, header.needed - 1]);
    if (!head) return null;
    header = decodeHeader(head);
    if (!header.complete) throw new Error('Incomplete tile pack header');
  }
  const { meta, levels, entries } = header;
  const tiles = cropTiles(crop, meta);
  // A row of tiles is stored contiguously, so each row is one read.
  const rows = new Map<number, typeof tiles>();
  for (const tile of tiles) {
    rows.set(tile.row, [...(rows.get(tile.row) ?? []), tile]);
  }
  const out: NotebookCropTile[] = [];
  for (const row of rows.values()) {
    const found = row
      .map((tile) => {
        const index = tileIndex(levels, tile.z, tile.row, tile.col);
        const entry = index === undefined ? undefined : entries[index];
        return entry && entry.length > 0 ? { tile, entry } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
    if (found.length === 0) continue;
    const start = found[0].entry.offset;
    const last = found[found.length - 1].entry;
    const bytes = await source.read(key, [
      start,
      last.offset + last.length - 1,
    ]);
    if (!bytes) return null;
    for (const { tile, entry } of found) {
      const at = entry.offset - start;
      out.push({
        left: tile.col * meta.tileSize - crop.left,
        top: tile.row * meta.tileSize - crop.top,
        size: meta.tileSize,
        type: meta.format,
        data: base64(bytes.subarray(at, at + entry.length)),
      });
    }
  }
  return out;
}

async function fromTiles(
  source: CropSource,
  sourceKey: string,
  crop: ReturnType<typeof cropWindow>,
  image: ImageRow
): Promise<NotebookCropTile[]> {
  const tiles = cropTiles(crop, {
    tileSize: TILE_SIZE,
    maxZoom: maxTileZoom(image),
  });
  const loaded = await Promise.all(
    tiles.map(async (tile) => {
      const bytes = await source.read(
        `slippymaps/${sourceKey}/${tileId(tile)}.png`
      );
      return bytes
        ? {
            left: tile.col * TILE_SIZE - crop.left,
            top: tile.row * TILE_SIZE - crop.top,
            size: TILE_SIZE,
            type: 'image/png',
            data: base64(bytes),
          }
        : null;
    })
  );
  return loaded.filter((t): t is NotebookCropTile => t !== null);
}

// Only pixels near the point leave the bucket: no keys, paths or ids.
export async function notebookCrop(
  source: CropSource,
  user: StorageIdentity,
  imageId: string,
  point: { x: number; y: number }
): Promise<NotebookCrop | null> {
  const image = await source.image(imageId);
  if (!image) return null;
  const project = await source.project(image.projectId);
  authorizeProject(user, project);
  const files = await source.files(image.id);
  const sourceKey = selectSourceKeyForImage(files, image.originalPath);
  const file = files.find((f) => f.key === sourceKey);
  if (!sourceKey || !file) return null;
  assertFileOwnership(file, image, project, sourceKey);
  if (!(image.width > 0 && image.height > 0)) return null;
  const crop = cropWindow(point, image);
  const tiles =
    (await fromPack(source, sourceKey, crop)) ??
    (await fromTiles(source, sourceKey, crop, image));
  if (tiles.length === 0) return null;
  return {
    width: crop.width,
    height: crop.height,
    point: { x: point.x - crop.left, y: point.y - crop.top },
    tiles,
  };
}
