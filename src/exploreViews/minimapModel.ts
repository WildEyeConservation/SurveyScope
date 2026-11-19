import {
  boundsOf,
  meanCosLat,
  ringToPlane,
  toPlane,
  type Bounds,
  type Plane,
} from './minimap';

export type Outline = { id: string; coordinates?: (number | null)[] | null };

export type MinimapImage = {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  transectId?: string | null;
  cameraId?: string | null;
  timestamp?: number | null;
};

export type MinimapModel = {
  images: MinimapImage[];
  plane: Plane;
  indexById: Map<string, number>;
  strata: [number, number][][];
  exclusions: [number, number][][];
  surveyBounds: Bounds | null;
  transectNumber: Map<string, number>;
  transectMembers: Map<string, number[]>;
  prevIdx: Int32Array;
  nextIdx: Int32Array;
};

export function buildMinimapModel(
  images: MinimapImage[],
  strata: Outline[],
  exclusions: Outline[],
): MinimapModel {
  const lats = images.map((i) => i.latitude ?? NaN);
  const lngs = images.map((i) => i.longitude ?? NaN);
  const cosLat = meanCosLat(lats);
  const plane = toPlane(lats, lngs, cosLat);
  const rings = (list: Outline[]) =>
    list
      .map((o) => ringToPlane(o.coordinates, cosLat))
      .filter((r): r is [number, number][] => !!r);
  const strataRings = rings(strata);
  const transectNumber = new Map<string, number>();
  const transectMembers = new Map<string, number[]>();
  const lines = new Map<string, number[]>();
  images.forEach((image, i) => {
    if (!Number.isFinite(plane.xs[i]) || !Number.isFinite(plane.ys[i])) return;
    const t = image.transectId;
    if (t) {
      if (!transectNumber.has(t))
        transectNumber.set(t, transectNumber.size + 1);
      const members = transectMembers.get(t) ?? [];
      members.push(i);
      transectMembers.set(t, members);
    }
    const key = `${t ?? ''}|${image.cameraId ?? ''}`;
    const line = lines.get(key) ?? [];
    line.push(i);
    lines.set(key, line);
  });
  const prevIdx = new Int32Array(images.length).fill(-1);
  const nextIdx = new Int32Array(images.length).fill(-1);
  for (const line of lines.values()) {
    line.sort(
      (a, b) => (images[a].timestamp ?? 0) - (images[b].timestamp ?? 0),
    );
    for (let k = 0; k < line.length; k++) {
      if (k > 0) prevIdx[line[k]] = line[k - 1];
      if (k + 1 < line.length) nextIdx[line[k]] = line[k + 1];
    }
  }
  return {
    images,
    plane,
    indexById: new Map(images.map((image, i) => [image.id, i])),
    strata: strataRings,
    exclusions: rings(exclusions),
    surveyBounds: boundsOf(plane, undefined, strataRings),
    transectNumber,
    transectMembers,
    prevIdx,
    nextIdx,
  };
}
