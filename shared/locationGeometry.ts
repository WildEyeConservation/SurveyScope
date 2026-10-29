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
