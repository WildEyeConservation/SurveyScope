import { getPyramidInfo, type Tile } from './tiles';

export interface PixelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function visibleImageTiles(
  width: number,
  height: number,
  z: number,
  bounds: PixelBounds
): Tile[] {
  const { pyramidSize } = getPyramidInfo({ width, height });
  const coverage = pyramidSize / 2 ** z;
  const left = Math.max(0, bounds.left);
  const top = Math.max(0, bounds.top);
  const right = Math.min(width, bounds.right);
  const bottom = Math.min(height, bounds.bottom);
  if (left >= right || top >= bottom) return [];
  const tiles: Tile[] = [];
  for (
    let row = Math.floor(top / coverage);
    row < Math.ceil(bottom / coverage);
    row++
  ) {
    for (
      let col = Math.floor(left / coverage);
      col < Math.ceil(right / coverage);
      col++
    ) {
      tiles.push({ z, row, col });
    }
  }
  return tiles;
}

/** Explored tiles override ring masks. */
export function mergeTileRequests(
  rings: readonly Tile[],
  explored: Iterable<Tile>
): Map<string, Tile> {
  const requests = new Map<string, Tile>();
  for (const tile of rings)
    requests.set(`tile-${tile.z}-${tile.row}-${tile.col}`, tile);
  for (const { z, row, col } of explored)
    requests.set(`tile-${z}-${row}-${col}`, { z, row, col });
  return requests;
}
