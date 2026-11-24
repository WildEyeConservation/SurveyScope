import { selectSourceKeyForImage } from '../../../shared/imageSourceKey';
import type { TileCoordinate } from '../../../shared/imageTiles';
import {
  CROP_SIZE,
  cropFits,
  cropTiles,
  cropWindow,
  type CropWindow,
  type NotebookCrop,
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
} from '../imageAccess/authorization';

export type CropPiece = { bytes: Uint8Array; left: number; top: number };

export interface CropSource {
  image(id: string): Promise<ImageRow | undefined>;
  project(id: string): Promise<ProjectRow | undefined>;
  files(imageId: string): Promise<ImageFileRow[]>;
  read(key: string, range?: [number, number]): Promise<Uint8Array | null>;
  compose(size: number, pieces: CropPiece[]): Promise<Uint8Array | null>;
  // Returns null if the crop extends beyond the decoded raster.
  fromSource(sourceKey: string, crop: CropWindow): Promise<Uint8Array | null>;
}

async function fromPack(
  source: CropSource,
  sourceKey: string,
  point: { x: number; y: number }
) {
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
  // The pack's own size, which can differ from the image row.
  if (!cropFits(point, meta)) return { bytes: null };
  const crop = cropWindow(point);
  const tiles = cropTiles(crop, meta);
  // A row of tiles is stored contiguously, so each row is one read.
  const rows = new Map<number, TileCoordinate[]>();
  for (const tile of tiles)
    rows.set(tile.row, [...(rows.get(tile.row) ?? []), tile]);
  const out: { tile: TileCoordinate; bytes: Uint8Array }[] = [];
  for (const row of rows.values()) {
    const found = row.flatMap((tile) => {
      const index = tileIndex(levels, tile.z, tile.row, tile.col);
      const entry = index === undefined ? undefined : entries[index];
      return entry && entry.length > 0 ? [{ tile, entry }] : [];
    });
    if (found.length === 0) continue;
    const start = found[0].entry.offset;
    const last = found[found.length - 1].entry;
    const bytes = await source.read(key, [start, last.offset + last.length - 1]);
    if (!bytes) return null;
    for (const { tile, entry } of found) {
      const at = entry.offset - start;
      out.push({ tile, bytes: bytes.subarray(at, at + entry.length) });
    }
  }
  if (out.length === 0) return { bytes: null };
  return {
    bytes: await source.compose(
      CROP_SIZE,
      out.map(({ tile, bytes }) => ({
        bytes,
        left: tile.col * meta.tileSize - crop.left,
        top: tile.row * meta.tileSize - crop.top,
      }))
    ),
  };
}

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
  if (!cropFits(point, image)) return null;
  const packed = await fromPack(source, sourceKey, point);
  const bytes = packed
    ? packed.bytes
    : await source.fromSource(sourceKey, cropWindow(point));
  if (!bytes) return null;
  return {
    size: CROP_SIZE,
    type: 'image/webp',
    data: Buffer.from(bytes).toString('base64'),
  };
}
