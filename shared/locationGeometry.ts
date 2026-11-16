/** A location box; (x, y) is its centre. */
export type Box = { x: number; y: number; width: number; height: number };

export function isPointInBox(px: number, py: number, box: Box): boolean {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return (
    px >= box.x - halfW &&
    px <= box.x + halfW &&
    py >= box.y - halfH &&
    py <= box.y + halfH
  );
}

export function isCentreObserved(box: Box, observed: readonly Box[]): boolean {
  return observed.some((o) => isPointInBox(box.x, box.y, o));
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2
  );
}

// Small detections cover overlapping tiles; tile-sized reviews cover tile centres.
export function isTileSeen(tile: Box, reviewed: readonly Box[]): boolean {
  return reviewed.some((box) =>
    box.width >= tile.width / 2 && box.height >= tile.height / 2
      ? isPointInBox(tile.x, tile.y, box)
      : boxesOverlap(tile, box),
  );
}
