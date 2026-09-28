export const TILE_SIZE = 256;
export interface Tile {
  z: number;
  row: number;
  col: number;
  /** Full-resolution cells this tile may paint; omitted for a whole tile. */
  cells?: Array<{ row: number; col: number }>;
}

export function getPyramidInfo(image: { width: number; height: number }) {
  const maxZ = Math.max(
    0,
    Math.ceil(Math.log2(Math.max(image.width, image.height) / TILE_SIZE))
  );
  return { maxZ, pyramidSize: TILE_SIZE * 2 ** maxZ };
}

export interface TilePoint {
  x: number;
  y: number;
}

/** Kill switch for the rings around annotations. */
export const ZOOM_RING_ENABLED = true;
/**
 * Zoom drop per one-tile-wide ring around an annotation. [0, 3] on a 6-level
 * pyramid gives 6, 6, 3, then the base layer.
 */
export const RING_ZOOM_DROPS: readonly number[] = [0, 3];
/** Coarsest zoom painted across the whole image. */
export const BASE_ZOOM = 1;

export function baseZoom(maxZ: number) {
  return Math.min(BASE_ZOOM, maxZ);
}

export function baseTiles(width: number, height: number): Tile[] {
  const { maxZ, pyramidSize } = getPyramidInfo({ width, height });
  const z = baseZoom(maxZ);
  const coverage = pyramidSize / 2 ** z;
  const tiles: Tile[] = [];
  for (let row = 0; row < Math.ceil(height / coverage); row++) {
    for (let col = 0; col < Math.ceil(width / coverage); col++) {
      tiles.push({ z, row, col });
    }
  }
  return tiles;
}

/** Undefined when the ring would be no sharper than the base layer. */
export interface RingOptions {
  /** Empty disables the rings. */
  drops?: readonly number[];
}

export function ringZoom(
  ring: number,
  maxZ: number,
  baseZ: number,
  { drops = RING_ZOOM_DROPS }: RingOptions = {}
): number | undefined {
  if (ring === 0) return maxZ;
  if (ring > drops.length) return undefined;
  const z = maxZ - drops[ring - 1];
  return z > baseZ ? z : undefined;
}

/**
 * Full-resolution annotation tiles, RING_ZOOM_DROPS rings, then the base.
 * Coarse tiles are masked to their ring cells; the nearest annotation wins overlaps.
 */
export function annotationTiles(
  width: number,
  height: number,
  points: ReadonlyArray<TilePoint>,
  { drops = ZOOM_RING_ENABLED ? RING_ZOOM_DROPS : [] }: RingOptions = {}
): Tile[] {
  const { maxZ } = getPyramidInfo({ width, height });
  const cores = new Map<string, { row: number; col: number }>();
  for (const { x, y } of points) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    )
      continue;
    const row = Math.floor(y / TILE_SIZE);
    const col = Math.floor(x / TILE_SIZE);
    cores.set(`${row}/${col}`, { row, col });
  }
  if (!cores.size) return [];
  const cells = new Map<string, { row: number; col: number; z: number }>();
  const rows = Math.ceil(height / TILE_SIZE);
  const cols = Math.ceil(width / TILE_SIZE);
  const baseZ = baseZoom(maxZ);
  const radius = drops.length;
  for (const core of cores.values()) {
    for (
      let row = Math.max(0, core.row - radius);
      row <= Math.min(rows - 1, core.row + radius);
      row++
    ) {
      for (
        let col = Math.max(0, core.col - radius);
        col <= Math.min(cols - 1, core.col + radius);
        col++
      ) {
        const ring = Math.floor(Math.hypot(row - core.row, col - core.col));
        const z = ringZoom(ring, maxZ, baseZ, { drops });
        if (z === undefined) continue; // The base layer already paints this ring.
        const key = `${row}/${col}`;
        if (z > (cells.get(key)?.z ?? 0)) cells.set(key, { row, col, z });
      }
    }
  }
  const tiles = new Map<string, Tile>();
  // Sorted so mask keys are independent of annotation order.
  for (const cell of [...cells.values()].sort(
    (a, b) => b.z - a.z || a.row - b.row || a.col - b.col
  )) {
    const factor = 2 ** (maxZ - cell.z);
    const row = Math.floor(cell.row / factor);
    const col = Math.floor(cell.col / factor);
    const key = `${cell.z}/${row}/${col}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = { z: cell.z, row, col };
      if (cell.z !== maxZ) tile.cells = [];
      tiles.set(key, tile);
    }
    tile.cells?.push({ row: cell.row, col: cell.col });
  }
  return [...tiles.values(), ...baseTiles(width, height)];
}

/** Clip rectangles in tile pixels. */
export function tileMaskRects(tile: Tile, maxZ: number) {
  const factor = 2 ** (maxZ - tile.z);
  const size = TILE_SIZE / factor;
  return tile.cells?.map(({ row, col }) => ({
    x: (col - tile.col * factor) * size,
    y: (row - tile.row * factor) * size,
    width: size,
    height: size,
  }));
}

export function tileMaskKey(tile: Tile): string {
  return tile.cells?.map(({ row, col }) => `${row},${col}`).join(';') ?? 'full';
}

export function pairTilePoints(
  candidates: ReadonlyArray<{ posA: TilePoint | null; posB: TilePoint | null }>,
  side: 'A' | 'B',
  imageId: string,
  foreignAnnotations: ReadonlyArray<TilePoint & { imageId: string }>
): TilePoint[] {
  const points: TilePoint[] = [];
  for (const candidate of candidates) {
    const point = side === 'A' ? candidate.posA : candidate.posB;
    if (point) points.push(point);
  }
  for (const annotation of foreignAnnotations) {
    if (annotation.imageId === imageId)
      points.push({ x: annotation.x, y: annotation.y });
  }
  return points;
}

/** Next then previous entry. */
export function adjacentPairIndices(
  entries: readonly number[],
  currentIndex: number
): number[] {
  const pos = entries.indexOf(currentIndex);
  if (pos < 0) return [];
  return [entries[pos + 1], entries[pos - 1]].filter(
    (index) => index !== undefined
  );
}
