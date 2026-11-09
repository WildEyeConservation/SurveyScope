export type OverlapImage = {
  id: string;
  cameraId: string | null;
  transectId: string | null;
  lat: number;
  lng: number;
  timestamp: number;
  width: number;
  height: number;
  originalPath?: string | null;
  boundaryStatus?: string | null;
};

export type PlacedImage = { image: OverlapImage; left: number };
export type BoardRow = { cameraKey: string; images: PlacedImage[] };
export type BoardSection = { transectId: string; rows: BoardRow[] };

export const NO_CAMERA = 'none';
export const NO_TRANSECT = 'none';

type Vec = { x: number; y: number };

const METRES_PER_DEGREE = 111_320;

export const cameraKeyOf = (image: OverlapImage) => image.cameraId ?? NO_CAMERA;
export const transectKeyOf = (image: OverlapImage) =>
  image.transectId ?? NO_TRANSECT;

function groupBy<T>(items: T[], key: (item: T) => string) {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = out.get(k) ?? [];
    group.push(item);
    out.set(k, group);
  }
  return out;
}

function projector(images: OverlapImage[]) {
  const lat0 = images.reduce((s, i) => s + i.lat, 0) / images.length;
  const lng0 = images.reduce((s, i) => s + i.lng, 0) / images.length;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  return (i: OverlapImage): Vec => ({
    x: (i.lng - lng0) * METRES_PER_DEGREE * cosLat,
    y: (i.lat - lat0) * METRES_PER_DEGREE,
  });
}

// Principal axis of the best-covered transect, pointing east-ish.
function flightAxis(images: OverlapImage[], toXY: (i: OverlapImage) => Vec) {
  const groups = [...groupBy(images, transectKeyOf).values()].sort(
    (a, b) => b.length - a.length,
  );
  const points = (groups[0] ?? []).map(toXY);
  let axis: Vec = { x: 1, y: 0 };
  if (points.length >= 2) {
    const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const my = points.reduce((s, p) => s + p.y, 0) / points.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of points) {
      sxx += (p.x - mx) ** 2;
      syy += (p.y - my) ** 2;
      sxy += (p.x - mx) * (p.y - my);
    }
    if (sxx + syy > 0) {
      const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      axis = { x: Math.cos(angle), y: Math.sin(angle) };
    }
  }
  if (axis.x < 0 || (axis.x === 0 && axis.y < 0))
    axis = { x: -axis.x, y: -axis.y };
  return axis;
}

// Every row starts at the left edge, ordered along a shared flight direction.
export function layoutBoard(
  images: OverlapImage[],
  slot: number | ((transectId: string, cameraKey: string) => number),
  defaultCameraOrder: (a: string, b: string) => number,
  rowOrder: Record<string, string[]> = {},
): { sections: BoardSection[]; width: number } {
  if (!images.length) return { sections: [], width: 0 };
  const toXY = projector(images);
  const axis = flightAxis(images, toXY);
  const across: Vec = { x: -axis.y, y: axis.x };
  const along = new Map<string, number>();
  const side = new Map<string, number>();
  for (const image of images) {
    const p = toXY(image);
    along.set(image.id, p.x * axis.x + p.y * axis.y);
    side.set(image.id, p.x * across.x + p.y * across.y);
  }
  const at = (i: OverlapImage) => along.get(i.id)!;

  const rows = [...groupBy(images, transectKeyOf)].map(
    ([transectId, members]) => ({
      transectId,
      side: members.reduce((s, i) => s + side.get(i.id)!, 0) / members.length,
      cameras: [...groupBy(members, cameraKeyOf)].map(([cameraKey, imgs]) => ({
        cameraKey,
        imgs: imgs.sort((a, b) => at(a) - at(b)),
      })),
    }),
  );

  let width = 0;
  const sections = rows
    // North-most transect on top, as on the map.
    .sort((a, b) => b.side - a.side)
    .map(({ transectId, cameras }) => {
      const saved = rowOrder[transectId] ?? [];
      const rank = (key: string) => {
        const index = saved.indexOf(key);
        return index === -1 ? Infinity : index;
      };
      return {
        transectId,
        rows: cameras
          .sort(
            (a, b) =>
              rank(a.cameraKey) - rank(b.cameraKey) ||
              defaultCameraOrder(a.cameraKey, b.cameraKey),
          )
          .map(({ cameraKey, imgs }) => {
            const step =
              typeof slot === 'number' ? slot : slot(transectId, cameraKey);
            const placed = imgs.map((image, index) => ({
              image,
              left: Math.round(index * step),
            }));
            width = Math.max(width, Math.round(imgs.length * step));
            return { cameraKey, images: placed };
          }),
      };
    });
  return { sections, width };
}

export function moveKey(order: string[], key: string, toIndex: number) {
  const next = order.filter((k) => k !== key);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, key);
  return next;
}
