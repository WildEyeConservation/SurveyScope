import { getTileBlob, imageTileContext } from '../../StorageLayer';
import { maxTileZoom } from '../../../shared/imageTiles';

export interface LoadedSample {
  url: string;
  revoke: () => void;
}

export interface MaskSample {
  label: string;
  load: () => Promise<LoadedSample>;
}

const PREVIEW_MAX_PX = 2000;

const canvasToSample = (canvas: HTMLCanvasElement): Promise<LoadedSample> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('Could not render preview'));
        const url = URL.createObjectURL(blob);
        resolve({ url, revoke: () => URL.revokeObjectURL(url) });
      },
      'image/jpeg',
      0.85
    )
  );

export async function loadLocalSample(
  file: File,
  rotationCCW: number
): Promise<LoadedSample> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  try {
    const scale = Math.min(
      1,
      PREVIEW_MAX_PX / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const swaps = rotationCCW % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = swaps ? height : width;
    canvas.height = swaps ? width : height;
    const ctx = canvas.getContext('2d')!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-rotationCCW * Math.PI) / 180);
    ctx.drawImage(bitmap, -width / 2, -height / 2, width, height);
    return await canvasToSample(canvas);
  } finally {
    bitmap.close();
  }
}

export async function loadStoredSample(
  image: { id: string; width: number; height: number },
  sourceKey: string
): Promise<LoadedSample> {
  const maxZ = maxTileZoom(image);
  const z = Math.min(maxZ, 3);
  const coverage = 256 * 2 ** (maxZ - z);
  const cols = Math.ceil(image.width / coverage);
  const rows = Math.ceil(image.height / coverage);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((image.width / coverage) * 256);
  canvas.height = Math.round((image.height / coverage) * 256);
  const ctx = canvas.getContext('2d')!;
  const context = imageTileContext(image);
  await Promise.all(
    Array.from({ length: rows * cols }, async (_, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const blob = await getTileBlob(
        `slippymaps/${sourceKey}/${z}/${row}/${col}.png`,
        context
      );
      const bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, col * 256, row * 256, 256, 256);
      bitmap.close();
    })
  );
  return canvasToSample(canvas);
}

export const MASK_HELP =
  'Masked regions are ignored when images are registered to each other, and model detections inside them are discarded. Use them for static objects such as a wheel or wing strut. Click on the image to add polygon corners; click the first corner (or double-click) to finish. Drag corners to adjust and right-click a polygon to remove it.';

export function strideSamples<T>(items: T[], count = 7): T[] {
  if (items.length <= count) return items;
  const stride = items.length / count;
  return Array.from(
    { length: count },
    (_, i) => items[Math.floor(i * stride + stride / 2)]
  );
}
