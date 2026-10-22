export type BoundaryStatus = 'inside' | 'outside' | 'excluded';

// Rings are open or closed and ordered [lat, lng].
export type LatLngRing = [number, number][];

export interface BoundaryArea {
  boundary: LatLngRing | null;
  exclusions: LatLngRing[];
  // Images within this distance of the boundary count as inside it.
  marginM: number;
}

// A missing status predates this field and is treated as inside.
export function isOnEffort(status: BoundaryStatus | null | undefined): boolean {
  return status !== 'outside' && status !== 'excluded';
}

export function boundaryRecomputePending(
  project: {
    boundaryRecomputeRequested?: boolean | null;
    boundaryRecomputeLeaseUntil?: string | null;
  },
  now = Date.now()
): boolean {
  if (project.boundaryRecomputeRequested) return true;
  const until = Date.parse(project.boundaryRecomputeLeaseUntil ?? '');
  return Number.isFinite(until) && until > now;
}

const METERS_PER_DEGREE_LAT = 110574;
const METERS_PER_DEGREE_LNG = 111320;
// Points on an edge count as inside it.
const EDGE_TOLERANCE_M = 0.01;

type Ring = {
  points: LatLngRing;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

function toRing(points: LatLngRing | null): Ring | null {
  const valid = (points ?? []).filter(
    ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng)
  );
  if (valid.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of valid) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { points: valid, minLat, maxLat, minLng, maxLng };
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
    const [latI, lngI] = points[i];
    const [latJ, lngJ] = points[j];
    if (
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Planar distance in metres; accurate at the scale of a survey margin.
function distanceToRingM(lat: number, lng: number, ring: Ring): number {
  const kx = METERS_PER_DEGREE_LNG * Math.cos((lat * Math.PI) / 180);
  const ky = METERS_PER_DEGREE_LAT;
  const points = ring.points;
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const ax = (points[j][1] - lng) * kx;
    const ay = (points[j][0] - lat) * ky;
    const bx = (points[i][1] - lng) * kx;
    const by = (points[i][0] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq > 0
        ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq))
        : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, px * px + py * py);
  }
  return Math.sqrt(best);
}

function nearRing(lat: number, lng: number, ring: Ring, marginM: number) {
  const padLat = marginM / METERS_PER_DEGREE_LAT;
  const padLng =
    marginM /
    (METERS_PER_DEGREE_LNG * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  if (
    lat < ring.minLat - padLat ||
    lat > ring.maxLat + padLat ||
    lng < ring.minLng - padLng ||
    lng > ring.maxLng + padLng
  ) {
    return false;
  }
  return distanceToRingM(lat, lng, ring) <= marginM;
}

// Returns null for positions that cannot be classified.
export function createBoundaryClassifier(
  area: BoundaryArea
): (
  lat: number | null | undefined,
  lng: number | null | undefined
) => BoundaryStatus | null {
  const boundary = toRing(area.boundary);
  const exclusions = area.exclusions
    .map(toRing)
    .filter((ring): ring is Ring => ring !== null);
  const marginM = Math.max(0, Number(area.marginM) || 0);
  return (lat, lng) => {
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return null;
    }
    if (
      boundary &&
      !inRing(lat, lng, boundary) &&
      !nearRing(lat, lng, boundary, Math.max(marginM, EDGE_TOLERANCE_M))
    ) {
      return 'outside';
    }
    if (
      exclusions.some(
        (ring) =>
          inRing(lat, lng, ring) || nearRing(lat, lng, ring, EDGE_TOLERANCE_M)
      )
    ) {
      return 'excluded';
    }
    return 'inside';
  };
}
