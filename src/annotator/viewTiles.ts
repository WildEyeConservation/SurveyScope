import { makeProjection } from './imageProjection';

export interface ViewTile {
  z: number;
  row: number;
  col: number;
}

const WORLD_SIZE_AT_ZOOM_0 = 512;
const TILE_SIZE = 256;
const DEFAULT_VIEW_BOUNDS_SCALE = 1.5;

export function viewTiles(input: {
  image: { width: number; height: number };
  location: { x: number; y: number; width: number; height: number };
  zoom?: number | null;
  viewport: { width: number; height: number };
}): ViewTile[] {
  const { image, location, zoom, viewport } = input;
  const projection = makeProjection(image.width, image.height);
  const n = projection.size;
  let scale: number;
  if (zoom != null) {
    scale = (WORLD_SIZE_AT_ZOOM_0 * 2 ** (zoom - 1)) / n;
  } else {
    const s = DEFAULT_VIEW_BOUNDS_SCALE;
    scale = Math.min(
      viewport.width / (2 * location.width * s),
      viewport.height / (2 * location.height * s),
    );
  }
  if (!Number.isFinite(scale) || scale <= 0) return [];
  // Raster sources round to the nearest level and stop at the source maxzoom.
  const z = Math.min(
    projection.maxNativeZoom,
    Math.max(0, Math.round(Math.log2((scale * n) / TILE_SIZE))),
  );
  const tilePx = n / 2 ** z;
  const cols = Math.ceil(image.width / tilePx);
  const rows = Math.ceil(image.height / tilePx);
  const halfW = viewport.width / 2 / scale;
  const halfH = viewport.height / 2 / scale;
  const span = (centre: number, half: number, count: number) => [
    Math.max(0, Math.floor((centre - half) / tilePx)),
    Math.min(count - 1, Math.ceil((centre + half) / tilePx) - 1),
  ];
  const [col0, col1] = span(location.x, halfW, cols);
  const [row0, row1] = span(location.y, halfH, rows);
  const tiles: ViewTile[] = [];
  for (let row = row0; row <= row1; row++)
    for (let col = col0; col <= col1; col++) tiles.push({ z, row, col });
  return tiles;
}
