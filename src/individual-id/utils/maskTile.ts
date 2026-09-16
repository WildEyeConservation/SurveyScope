import { TILE_SIZE, tileMaskRects, type Tile } from './tiles';

export async function maskTile(
  blob: Blob,
  tile: Tile,
  maxZ: number
): Promise<Blob> {
  const rects = tileMaskRects(tile, maxZ);
  if (!rects) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot create tile mask canvas');
    ctx.beginPath();
    for (const rect of rects) ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (masked) =>
          masked
            ? resolve(masked)
            : reject(new Error('Cannot encode masked tile')),
        'image/png'
      );
    });
  } finally {
    bitmap.close();
  }
}
