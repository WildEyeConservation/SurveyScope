import { maxTileZoom } from '../../shared/imageTiles';
import { loadImageFiles, sourceKeyOf } from '../annotator/useImageFileSource';
import { makeLimiter } from '../storage/tilePackReader';
import { getTileBlob, imageTileContext } from '../StorageLayer';

const TILE = 256;
const limiter = makeLimiter(6);

type Client = Parameters<typeof loadImageFiles>[0];

export function loadThumbnail(
  client: Client,
  image: { id: string; width: number; height: number },
  targetPx: number,
  signal: AbortSignal,
): Promise<string> {
  return limiter.run(async () => {
    const key = sourceKeyOf(await loadImageFiles(client, image.id));
    if (!key) throw new Error('Image file not found');
    const maxZ = maxTileZoom(image);
    const longest = Math.max(image.width, image.height);
    const z = Math.max(
      0,
      Math.min(maxZ, Math.ceil(maxZ - Math.log2(longest / targetPx))),
    );
    const coverage = TILE * 2 ** (maxZ - z);
    const cols = Math.ceil(image.width / coverage);
    const rows = Math.ceil(image.height / coverage);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((image.width / coverage) * TILE);
    canvas.height = Math.round((image.height / coverage) * TILE);
    const ctx = canvas.getContext('2d')!;
    const context = imageTileContext(image);
    await Promise.all(
      Array.from({ length: rows * cols }, async (_, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const blob = await getTileBlob(
          `slippymaps/${key}/${z}/${row}/${col}.png`,
          context,
        );
        const bitmap = await createImageBitmap(blob);
        ctx.drawImage(bitmap, col * TILE, row * TILE, TILE, TILE);
        bitmap.close();
      }),
    );
    signal.throwIfAborted();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) throw new Error('Could not render thumbnail');
    return URL.createObjectURL(blob);
  }, signal);
}
