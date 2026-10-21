import { maxZoomFor, pyramid, tileIndex } from './tilePack';

/** Coordinates use the stored pyramid order: zoom / row / column. */
export interface TileCoordinate {
  z: number;
  row: number;
  col: number;
}
export interface TileImage {
  width: number;
  height: number;
}
// Generated PNG batches are capped lower to stay under AppSync response limits.
export const MAX_TILE_BATCH = 128;
export const MAX_GENERATED_TILE_BATCH = 8;
export const tileId = ({ z, row, col }: TileCoordinate) => `${z}/${row}/${col}`;
const TILE_SIZE = 256;
export function maxTileZoom(image: TileImage): number {
  return maxZoomFor(image.width, image.height, TILE_SIZE);
}
export function validTile(tile: TileCoordinate, image: TileImage): boolean {
  if (
    ![image.width, image.height].every((v) => Number.isSafeInteger(v) && v > 0)
  )
    return false;
  if (
    ![tile.z, tile.row, tile.col].every(
      (v) => Number.isSafeInteger(v) && v >= 0
    )
  )
    return false;
  const { levels } = pyramid({
    ...image,
    tileSize: TILE_SIZE,
    maxZoom: maxTileZoom(image),
  });
  return tileIndex(levels, tile.z, tile.row, tile.col) !== undefined;
}
/** One tile border (including diagonals), then its parents. Never pre-sign children. */
export function bufferedTiles(
  visible: TileCoordinate[],
  image: TileImage
): TileCoordinate[] {
  const result = new Map<string, TileCoordinate>();
  const add = (tile: TileCoordinate) => {
    if (validTile(tile, image)) result.set(tileId(tile), tile);
  };
  visible.forEach(add); // Requested tiles have priority when splitting batches.
  for (const tile of visible) {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const neighbour = { z: tile.z, row: tile.row + dr, col: tile.col + dc };
        if (!validTile(neighbour, image)) continue;
        add(neighbour);
        if (tile.z > 0)
          add({
            z: tile.z - 1,
            row: Math.floor(neighbour.row / 2),
            col: Math.floor(neighbour.col / 2),
          });
      }
  }
  return [...result.values()];
}
