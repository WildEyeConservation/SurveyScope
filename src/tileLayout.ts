export type TileRect = {
  col: number;
  row: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type TileLayout = {
  width: number;
  height: number;
  across: number;
  down: number;
};

export type TileGrid = TileLayout & { xStep: number; yStep: number };

// Mirrors generateTiledLocations in launchAnnotationSet.
export function tileGrid(
  image: { width: number; height: number },
  layout: TileLayout,
  baselineLandscape: boolean,
): TileGrid {
  const swap = baselineLandscape !== image.width >= image.height;
  const width = swap ? layout.height : layout.width;
  const height = swap ? layout.width : layout.height;
  const across = swap ? layout.down : layout.across;
  const down = swap ? layout.across : layout.down;
  return {
    width,
    height,
    across,
    down,
    xStep: across > 1 ? (image.width - width) / (across - 1) : 0,
    yStep: down > 1 ? (image.height - height) / (down - 1) : 0,
  };
}

export function tileAt(grid: TileGrid, col: number, row: number): TileRect {
  const x = Math.round(col * grid.xStep + grid.width / 2);
  const y = Math.round(row * grid.yStep + grid.height / 2);
  return {
    col,
    row,
    left: x - grid.width / 2,
    top: y - grid.height / 2,
    right: x + grid.width / 2,
    bottom: y + grid.height / 2,
  };
}

const nearestIndex = (value: number, size: number, step: number, n: number) =>
  step > 0
    ? Math.max(0, Math.min(n - 1, Math.round((value - size / 2) / step)))
    : 0;

export function nearestTile(grid: TileGrid, x: number, y: number) {
  return tileAt(
    grid,
    nearestIndex(x, grid.width, grid.xStep, grid.across),
    nearestIndex(y, grid.height, grid.yStep, grid.down),
  );
}
