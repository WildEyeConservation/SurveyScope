import * as turf from '@turf/turf';
import proj4 from 'proj4';
import type { Feature, Polygon } from 'geojson';
import { getBaselineBearing } from './baselineBearing';
import type { LatLngRing } from './boundaryStatus';

export type TrackPoint = { latitude: number; longitude: number };

function ringPolygon(ring: LatLngRing): Feature<Polygon> | null {
  const coords = ring
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
    .map(([lat, lng]) => [lng, lat]);
  if (coords.length > 1) {
    const [fx, fy] = coords[0];
    const [lx, ly] = coords[coords.length - 1];
    if (fx === lx && fy === ly) coords.pop();
  }
  if (coords.length < 3) return null;
  return turf.polygon([[...coords, coords[0]]]);
}

export function hasStratumShape(ring: LatLngRing): boolean {
  return ringPolygon(ring) !== null;
}

function utmProjection(lon: number, lat: number) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs ${
    lat >= 0 ? '' : '+south'
  }`;
}

// Length of the polygon's extent along the bearing, in metres.
function baselineLength(polygon: Feature<Polygon>, bearing: number): number {
  const center = turf.centerOfMass(polygon).geometry.coordinates;
  const projStr = utmProjection(center[0], center[1]);
  const coords = turf.getCoords(polygon)[0] as [number, number][];
  const projected = coords.map(
    (pt) => proj4('WGS84', projStr, pt) as [number, number]
  );
  const centerXY = proj4('WGS84', projStr, center);
  const theta = (bearing * Math.PI) / 180;
  const yVals = projected.map(([x, y]) => {
    const dx = x - centerXY[0];
    const dy = y - centerXY[1];
    return dx * Math.sin(theta) + dy * Math.cos(theta);
  });
  const minY = Math.min(...yVals);
  const maxY = Math.max(...yVals);
  const pt1 = proj4(projStr, 'WGS84', [
    centerXY[0] + minY * Math.sin(theta),
    centerXY[1] + minY * Math.cos(theta),
  ]);
  const pt2 = proj4(projStr, 'WGS84', [
    centerXY[0] + maxY * Math.sin(theta),
    centerXY[1] + maxY * Math.cos(theta),
  ]);
  return turf.length(turf.lineString([pt1, pt2]), { units: 'meters' });
}

// Overlapping exclusions are subtracted in full.
export function stratumMetrics(
  ring: LatLngRing,
  exclusions: LatLngRing[],
  tracks: TrackPoint[][]
): { area: number; baselineLength: number } | null {
  const poly = ringPolygon(ring);
  if (!poly) return null;
  let exclusionArea = 0;
  for (const exclusionRing of exclusions) {
    const exclusion = ringPolygon(exclusionRing);
    if (exclusion && turf.booleanIntersects(poly, exclusion)) {
      exclusionArea += turf.area(exclusion);
    }
  }
  return {
    area: (turf.area(poly) - exclusionArea) / 1e6,
    baselineLength: baselineLength(poly, getBaselineBearing(tracks)),
  };
}

// Falls back to the nearest centroid when the point is outside all strata.
export function createStratumLocator(
  strata: LatLngRing[]
): (point: TrackPoint) => number | null {
  const polys = strata.map(ringPolygon);
  const centroids = polys.map((poly) => (poly ? turf.centroid(poly) : null));
  return ({ latitude, longitude }) => {
    const pt = turf.point([longitude, latitude]);
    const inside = polys.findIndex(
      (poly) => !!poly && turf.booleanPointInPolygon(pt, poly)
    );
    if (inside !== -1) return inside;
    let best = Infinity;
    let index: number | null = null;
    centroids.forEach((centroid, i) => {
      if (!centroid) return;
      const d = turf.distance(pt, centroid);
      if (d < best) {
        best = d;
        index = i;
      }
    });
    return index;
  };
}
