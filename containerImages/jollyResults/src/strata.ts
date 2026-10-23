// Container-local copy of shared/boundaryStatus.ts's assigner.

const METERS_PER_DEGREE_LAT = 110574;
const METERS_PER_DEGREE_LNG = 111320;

type LatLng = [number, number];

interface Ring {
  points: LatLng[];
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Stratum coordinates are stored flat as [lat, lng, lat, lng, ...].
function toRing(coordinates: number[] | null | undefined): Ring | null {
  const flat = (coordinates ?? []).filter((n) => Number.isFinite(n));
  const points: LatLng[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push([flat[i]!, flat[i + 1]!]);
  }
  if (points.length < 3) return null;
  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  return {
    points,
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
}

function inRing(lat: number, lng: number, ring: Ring): boolean {
  if (
    lat < ring.minLat ||
    lat > ring.maxLat ||
    lng < ring.minLng ||
    lng > ring.maxLng
  ) {
    return false;
  }
  const points = ring.points;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [latI, lngI] = points[i]!;
    const [latJ, lngJ] = points[j]!;
    if (
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToRingM(lat: number, lng: number, ring: Ring): number {
  const kx = METERS_PER_DEGREE_LNG * Math.cos((lat * Math.PI) / 180);
  const ky = METERS_PER_DEGREE_LAT;
  const points = ring.points;
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const ax = (points[j]![1] - lng) * kx;
    const ay = (points[j]![0] - lat) * ky;
    const bx = (points[i]![1] - lng) * kx;
    const by = (points[i]![0] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq > 0
        ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq))
        : 0;
    best = Math.min(best, (ax + t * dx) ** 2 + (ay + t * dy) ** 2);
  }
  return Math.sqrt(best);
}

// Points outside all polygons use the nearest stratum.
export function createStratumAssigner<
  T extends { coordinates?: number[] | null }
>(strata: T[]): (lat: number, lng: number) => T | null {
  const rings = strata
    .map((stratum) => ({ stratum, ring: toRing(stratum.coordinates) }))
    .filter((entry): entry is { stratum: T; ring: Ring } => !!entry.ring);
  if (rings.length === 0) {
    return strata.length === 1 ? () => strata[0]! : () => null;
  }
  return (lat, lng) => {
    const inside = rings.find(({ ring }) => inRing(lat, lng, ring));
    if (inside) return inside.stratum;
    let best: T | null = null;
    let bestDistance = Infinity;
    for (const { stratum, ring } of rings) {
      const distance = distanceToRingM(lat, lng, ring);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = stratum;
      }
    }
    return best;
  };
}
