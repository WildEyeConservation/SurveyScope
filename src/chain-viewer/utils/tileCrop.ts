import { getTileBlob } from '../../StorageLayer';

const TILE_SIZE = 256;
const CROP_SIZE = 256;

/**
 * Slippy-map pyramid info for an image, mirroring IndividualIdMap's formula:
 * `maxZ = ceil(log2(maxDim / TILE_SIZE))`. The pyramid is square with side
 * `TILE_SIZE * 2^maxZ`, but at maxZ a tile covers exactly TILE_SIZE pixels of
 * the original image so the math collapses nicely for our centered-crop case.
 */
function getMaxZ(width: number, height: number): number {
  return Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE)));
}

export interface CropZoomRange {
  /** Highest slippy level — 1:1 with the original image (tightest crop). */
  maxZ: number;
  /**
   * Number of whole zoom-out steps available from maxZ. Each step drops to the
   * next lower slippy level, doubling the field of view (and halving detail).
   * Bounded so every level still fully covers a CROP_SIZE window — no partial /
   * out-of-bounds tiles to fetch.
   */
  maxSteps: number;
}

/**
 * Available centred-crop zoom levels for an image. The tightest level (maxZ)
 * frames the annotation at native resolution; each zoom-out step pulls
 * lower-detail tiles that show 2× more of the surrounding image.
 */
export function getCropZoomRange(width: number, height: number): CropZoomRange {
  const maxZ = getMaxZ(width, height);
  const minDim = Math.min(width, height);
  const maxSteps = Math.max(
    0,
    Math.min(maxZ, Math.floor(Math.log2(minDim / CROP_SIZE)))
  );
  return { maxZ, maxSteps };
}

interface CropParams {
  sourceKey: string;
  imageId: string;
  sharedImageId?: string;
  imageWidth: number;
  imageHeight: number;
  x: number;
  y: number;
  /** Slippy level to crop from. Defaults to maxZ (tightest, 1:1 with source). */
  zoom?: number;
}

interface CropResult {
  /** Final composed canvas, sized to CROP_SIZE x CROP_SIZE. */
  canvas: HTMLCanvasElement;
  /** Annotation x,y projected into canvas coordinates. */
  markerX: number;
  markerY: number;
}

/**
 * Build a CROP_SIZE×CROP_SIZE thumbnail centred on (x,y) at the image's
 * highest slippy zoom (1:1 with the original image). Stitches up to four
 * adjacent tiles to produce the centred crop, then exposes the annotation's
 * position in canvas-space so the caller can draw a marker on it.
 *
 * If the annotation is near an image edge the window is clamped so it stays
 * fully inside the image bounds — the marker shifts off-centre rather than
 * leaving us with a transparent border.
 */
export async function fetchCenteredCrop(params: CropParams): Promise<CropResult> {
  const { sourceKey, imageWidth, imageHeight, x, y } = params;
  const maxZ = getMaxZ(imageWidth, imageHeight);
  const z = Math.max(0, Math.min(params.zoom ?? maxZ, maxZ));

  // Project the annotation and image extent into this level's pyramid pixels.
  // scale = 1 at maxZ, halves for each level down (lower detail, wider view).
  const scale = Math.pow(2, z - maxZ);
  const px = x * scale;
  const py = y * scale;
  const renderedW = imageWidth * scale;
  const renderedH = imageHeight * scale;

  const half = CROP_SIZE / 2;
  let left = Math.round(px - half);
  let top = Math.round(py - half);
  // Clamp window inside the rendered image when it's at least CROP_SIZE.
  if (renderedW >= CROP_SIZE) {
    left = Math.max(0, Math.min(left, Math.floor(renderedW) - CROP_SIZE));
  } else {
    left = 0;
  }
  if (renderedH >= CROP_SIZE) {
    top = Math.max(0, Math.min(top, Math.floor(renderedH) - CROP_SIZE));
  } else {
    top = 0;
  }

  const right = left + CROP_SIZE;
  const bottom = top + CROP_SIZE;

  const minCol = Math.floor(left / TILE_SIZE);
  const maxCol = Math.floor((right - 1) / TILE_SIZE);
  const minRow = Math.floor(top / TILE_SIZE);
  const maxRow = Math.floor((bottom - 1) / TILE_SIZE);

  const canvas = document.createElement('canvas');
  canvas.width = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#1f2933';
  ctx.fillRect(0, 0, CROP_SIZE, CROP_SIZE);

  const tilePromises: Promise<{
    img: HTMLImageElement;
    row: number;
    col: number;
    url: string;
  }>[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const path = `slippymaps/${sourceKey}/${z}/${row}/${col}.png`;
      tilePromises.push(
        getTileBlob(path, {
          imageId: params.imageId,
          width: imageWidth,
          height: imageHeight,
          sharedImageId: params.sharedImageId,
        }).then(
          (blob) =>
            new Promise<{
              img: HTMLImageElement;
              row: number;
              col: number;
              url: string;
            }>((resolve, reject) => {
              const url = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => resolve({ img, row, col, url });
              img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(`Failed to decode tile ${path}`));
              };
              img.src = url;
            })
        )
      );
    }
  }

  const tiles = await Promise.all(tilePromises);
  try {
    for (const { img, row, col } of tiles) {
      const tileLeftInImage = col * TILE_SIZE;
      const tileTopInImage = row * TILE_SIZE;
      ctx.drawImage(img, tileLeftInImage - left, tileTopInImage - top);
    }
  } finally {
    tiles.forEach((t) => URL.revokeObjectURL(t.url));
  }

  return {
    canvas,
    markerX: px - left,
    markerY: py - top,
  };
}

export const CHAIN_TILE_SIZE = CROP_SIZE;
