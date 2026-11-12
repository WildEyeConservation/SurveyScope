export type Size = { width: number; height: number };

// x and y are the centre, as on Location.
export type Box = Size & { x: number; y: number };

// Tiling swaps tile width and height on images oriented unlike the survey's.
export function tileSizeForImage(
  sample: { tile: Size; image: Size },
  image: Size,
): Size {
  const sampleLandscape = sample.image.width >= sample.image.height;
  const imageLandscape = image.width >= image.height;
  return sampleLandscape === imageLandscape
    ? { width: sample.tile.width, height: sample.tile.height }
    : { width: sample.tile.height, height: sample.tile.width };
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function placeAxis(
  centre: number,
  extent: number,
  tile: number,
  imageExtent: number,
  seed: string,
): number | null {
  const lo = Math.max(0, centre - extent / 2);
  const hi = Math.min(imageExtent, centre + extent / 2);
  if (hi - lo > tile) return null;
  // Real tiles larger than the image start at its edge and run past the far one.
  if (tile >= imageExtent) return tile / 2;
  const min = Math.ceil(Math.max(0, hi - tile));
  const max = Math.floor(Math.min(lo, imageExtent - tile));
  const start =
    max >= min ? min + (hash(seed) % (max - min + 1)) : Math.max(0, hi - tile);
  return start + tile / 2;
}

export function growTestBox(
  box: Box,
  tile: Size,
  image: Size,
  seed: string,
): Box | null {
  const key = `${seed}:${tile.width}x${tile.height}`;
  const x = placeAxis(box.x, box.width, tile.width, image.width, `${key}:x`);
  const y = placeAxis(box.y, box.height, tile.height, image.height, `${key}:y`);
  if (x == null || y == null) return null;
  return { x, y, width: tile.width, height: tile.height };
}
