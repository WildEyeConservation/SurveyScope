import * as turf from '@turf/turf';
import proj4 from 'proj4';
import type {
  Feature as GeoJSONFeature,
  Polygon as GeoJSONPolygon,
  LineString as GeoJSONLineString,
} from 'geojson';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from '../utils';
import { isOnEffort } from '../../shared/boundaryStatus';
import { getBaselineBearing } from './baselineBearing';
import { ringToPolygon } from './new-survey/surveyArea';

export type LatLng = [number, number];

export type SurveyImage = {
  id: string;
  timestamp: number;
  cameraId: string | null;
  latitude: number;
  longitude: number;
  dbTransectId: string | null;
};

export type SavedStratum = { id: string; name: string; coords: LatLng[] };

export type SegmentedImage = SurveyImage & { transectId: number };

export const transectColors = [
  'red',
  'blue',
  'green',
  'orange',
  'purple',
  'brown',
  'pink',
  'cyan',
];

export const strataColors = [
  '#e6b800',
  '#00b3b3',
  '#cc00cc',
  '#808080',
  '#5cb85c',
  '#3399ff',
  '#f08080',
  '#ff69b4',
];

export function isFiniteNumber(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function isValidLatLng(lat: any, lng: any): boolean {
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function toLatLngPairs(
  values: Array<number | null | undefined>
): LatLng[] {
  const flat = values.filter((n): n is number => n != null);
  const pairs: LatLng[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (isValidLatLng(flat[i], flat[i + 1])) pairs.push([flat[i], flat[i + 1]]);
  }
  return pairs;
}

// Mixed second/millisecond timestamps -> milliseconds; missing stays NaN.
function normalizeToMillis(ts: any): number {
  const n = typeof ts === 'string' ? Number(ts) : ts ?? NaN;
  return n > 0 && n < 1e12 ? n * 1000 : n;
}

// Requires images sorted by timestamp.
function imputeLatLng<
  T extends { timestamp: number; latitude: any; longitude: any }
>(imgs: T[]): { filled: T[]; imputedIds: Set<number> } {
  const filled = imgs.map((img) => ({ ...img }));
  const n = filled.length;
  const isValid = filled.map((img) =>
    isValidLatLng(img.latitude, img.longitude)
  );
  const prev: number[] = Array(n).fill(-1);
  const next: number[] = Array(n).fill(-1);
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (isValid[i]) last = i;
    prev[i] = last;
  }
  last = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (isValid[i]) last = i;
    next[i] = last;
  }
  const imputedIds = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (isValid[i]) continue;
    const p = prev[i];
    const q = next[i];
    if (p === -1 && q === -1) continue;
    if (p !== -1 && q !== -1) {
      const t0 = filled[p].timestamp;
      const t1 = filled[q].timestamp;
      const r = Math.min(
        Math.max((filled[i].timestamp - t0) / Math.max(t1 - t0, 1), 0),
        1
      );
      filled[i].latitude =
        filled[p].latitude + r * (filled[q].latitude - filled[p].latitude);
      filled[i].longitude =
        filled[p].longitude + r * (filled[q].longitude - filled[p].longitude);
    } else {
      const src = filled[p !== -1 ? p : q];
      filled[i].latitude = src.latitude;
      filled[i].longitude = src.longitude;
    }
    imputedIds.add(i);
  }
  return { filled, imputedIds };
}

export async function loadOnEffortImages(
  client: DataClient,
  projectId: string,
  signal?: AbortSignal
): Promise<{
  images: SurveyImage[];
  imputedIds: Set<string>;
  dbTransectIds: Map<string, string | null>;
}> {
  const rawImgs = (await fetchAllPaginatedResults(
    client.models.Image.imagesByProjectId as any,
    {
      projectId,
      limit: 10000,
      selectionSet: [
        'id',
        'timestamp',
        'cameraId',
        'latitude',
        'longitude',
        'transectId',
        'boundaryStatus',
      ],
      signal,
    } as any
  )) as any[];
  const dbTransectIds = new Map<string, string | null>(
    rawImgs.map((img) => [img.id, img.transectId ?? null])
  );
  const onEffort = rawImgs
    .filter((img) => isOnEffort(img.boundaryStatus))
    .map((img) => ({
      id: img.id as string,
      timestamp: normalizeToMillis(img.timestamp),
      cameraId: (img.cameraId ?? null) as string | null,
      latitude: img.latitude,
      longitude: img.longitude,
      dbTransectId: (img.transectId ?? null) as string | null,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  const { filled, imputedIds } = imputeLatLng(onEffort);
  return {
    images: filled.filter((img) => isValidLatLng(img.latitude, img.longitude)),
    imputedIds: new Set([...imputedIds].map((i) => filled[i].id)),
    dbTransectIds,
  };
}

export async function loadStrata(
  client: DataClient,
  projectId: string,
  signal?: AbortSignal
): Promise<SavedStratum[]> {
  const strata = (await fetchAllPaginatedResults(
    client.models.Stratum.strataByProjectId as any,
    {
      projectId,
      limit: 10000,
      selectionSet: ['id', 'name', 'coordinates', 'offEffort'],
      signal,
    } as any
  )) as any[];
  return strata
    .filter((st) => !st.offEffort)
    .map((st) => ({
      id: st.id as string,
      name: st.name as string,
      coords: toLatLngPairs(st.coordinates ?? []),
    }))
    .filter((st) => st.coords.length >= 3)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function segmentBySavedTransect(images: SurveyImage[]): {
  segmented: SegmentedImage[];
  dbIdByIndex: string[];
} {
  const indexByDbId = new Map<string, number>();
  const segmented: SegmentedImage[] = [];
  for (const img of images) {
    if (!img.dbTransectId) continue;
    let index = indexByDbId.get(img.dbTransectId);
    if (index === undefined) {
      index = indexByDbId.size;
      indexByDbId.set(img.dbTransectId, index);
    }
    segmented.push({ ...img, transectId: index });
  }
  return { segmented, dbIdByIndex: [...indexByDbId.keys()] };
}

export function closedLngLatRing(coords: LatLng[]): [number, number][] {
  const ring = coords.map(([lat, lng]) => [lng, lat] as [number, number]);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring;
}

function getUTMProjection(lon: number, lat: number) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs ${
    lat >= 0 ? '' : '+south'
  }`;
}

function getProjectedDirectionalBaseline(
  polygon: GeoJSONFeature<GeoJSONPolygon>,
  bearing: number
): { baseline: GeoJSONFeature<GeoJSONLineString>; length: number } {
  const center = turf.centerOfMass(polygon).geometry.coordinates;
  const projStr = getUTMProjection(center[0], center[1]);
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
  const baseline = turf.lineString([pt1, pt2]);
  return { baseline, length: turf.length(baseline, { units: 'meters' }) };
}

// Overlapping exclusions are subtracted in full.
export function stratumMetrics(
  coords: LatLng[],
  exclusions: LatLng[][],
  transectIds: number[],
  segmented: SegmentedImage[]
): { area: number; baselineLength: number } {
  const poly = ringToPolygon(coords)!;
  let exclusionArea = 0;
  for (const ring of exclusions) {
    const exclusion = ringToPolygon(ring);
    if (exclusion && turf.booleanIntersects(poly, exclusion)) {
      exclusionArea += turf.area(exclusion);
    }
  }
  const { length } = getProjectedDirectionalBaseline(
    poly,
    getBaselineBearing(transectIds, segmented)
  );
  return {
    area: (turf.area(poly) - exclusionArea) / 1e6,
    baselineLength: length,
  };
}

// Fall back to the nearest centroid when the first image is outside all strata.
export function assignTransectsToStrata(
  segmented: SegmentedImage[],
  strata: LatLng[][]
): Map<number, number | null> {
  const polys = strata.map((coords) => ringToPolygon(coords)!);
  const centroids = polys.map((poly) => turf.centroid(poly));
  const assignment = new Map<number, number | null>();
  for (const img of segmented) {
    if (assignment.has(img.transectId)) continue;
    const pt = turf.point([img.longitude, img.latitude]);
    let index = polys.findIndex((poly) => turf.booleanPointInPolygon(pt, poly));
    if (index === -1 && polys.length) {
      let best = Infinity;
      centroids.forEach((c, i) => {
        const d = turf.distance(pt, c);
        if (d < best) {
          best = d;
          index = i;
        }
      });
    }
    assignment.set(img.transectId, index === -1 ? null : index);
  }
  return assignment;
}

export function transectsByStratum(
  assignment: Map<number, number | null>,
  strataCount: number
): number[][] {
  const groups: number[][] = Array.from({ length: strataCount }, () => []);
  for (const [tid, index] of assignment) {
    if (index !== null) groups[index].push(tid);
  }
  return groups;
}

export async function clearJollyResults(client: DataClient, projectId: string) {
  const jollyResults = (await fetchAllPaginatedResults(
    client.models.JollyResult.jollyResultsBySurveyId as any,
    {
      surveyId: projectId,
      limit: 10000,
      selectionSet: ['surveyId', 'stratumId', 'annotationSetId', 'categoryId'],
    } as any
  )) as any[];
  await Promise.all(
    jollyResults.map((jr) =>
      (client.models.JollyResult.delete as any)({
        surveyId: jr.surveyId,
        stratumId: jr.stratumId,
        annotationSetId: jr.annotationSetId,
        categoryId: jr.categoryId,
      })
    )
  );
}

export function splitPolygon(poly: LatLng[], line: LatLng[]): LatLng[][] {
  if (poly.length < 3 || line.length < 2) return [poly];
  const ringLngLat = closedLngLatRing(poly);
  const lineLngLat = line.map(([lat, lng]) => [lng, lat] as [number, number]);

  const polyFC = turf.polygon([ringLngLat]);
  const lineFC = turf.lineString(lineLngLat);
  const intersections = turf.lineIntersect(lineFC, turf.polygonToLine(polyFC));

  const uniquePtsMap: Record<string, any> = {};
  intersections.features.forEach((f) => {
    const [x, y] = f.geometry.coordinates;
    uniquePtsMap[`${x.toFixed(10)},${y.toFixed(10)}`] = f;
  });
  const uniquePts = Object.values(uniquePtsMap);
  if (uniquePts.length < 2) return [poly];

  const withLoc = uniquePts
    .map((pt) => ({
      pt,
      location: (turf.nearestPointOnLine(lineFC, pt).properties as any)
        .location as number,
    }))
    .sort((a, b) => a.location - b.location);
  const aPt = withLoc[0].pt;
  const bPt = withLoc[withLoc.length - 1].pt;

  const ringLine = turf.lineString(ringLngLat);
  const aOnRing = turf.nearestPointOnLine(ringLine, aPt);
  const bOnRing = turf.nearestPointOnLine(ringLine, bPt);
  const aIdx = (aOnRing.properties as any).index as number;
  const bIdx = (bOnRing.properties as any).index as number;

  const lineSliceCoords = turf.getCoords(turf.lineSlice(aPt, bPt, lineFC)) as [
    number,
    number
  ][];

  const ringNoClose = ringLngLat.slice(0, ringLngLat.length - 1);
  const ringLen = ringNoClose.length;
  const collectRingPath = (
    startIdx: number,
    endIdx: number,
    startCoord: [number, number],
    endCoord: [number, number]
  ): [number, number][] => {
    const path: [number, number][] = [startCoord];
    let i = (startIdx + 1) % ringLen;
    for (;;) {
      path.push(ringNoClose[i]);
      if (i === endIdx) break;
      i = (i + 1) % ringLen;
    }
    const last = path[path.length - 1];
    if (last[0] !== endCoord[0] || last[1] !== endCoord[1]) path.push(endCoord);
    return path;
  };

  const aCoord = aPt.geometry.coordinates as [number, number];
  const bCoord = bPt.geometry.coordinates as [number, number];
  const aT = ((aOnRing.properties as any)?.t as number | undefined) ?? 0;
  const bT = ((bOnRing.properties as any)?.t as number | undefined) ?? 1;

  // Both intersections on one edge need the short/long way round handled.
  let path1: [number, number][];
  let path2: [number, number][];
  if (aIdx === bIdx) {
    if (aT <= bT) {
      path1 = [aCoord, bCoord];
      path2 = collectRingPath(bIdx, aIdx, bCoord, aCoord);
    } else {
      path1 = collectRingPath(aIdx, bIdx, aCoord, bCoord);
      path2 = [bCoord, aCoord];
    }
  } else {
    path1 = collectRingPath(aIdx, bIdx, aCoord, bCoord);
    path2 = collectRingPath(bIdx, aIdx, bCoord, aCoord);
  }

  const segBtoA = lineSliceCoords.slice().reverse();
  const toLatLng = (coords: [number, number][]): LatLng[] => {
    const out = coords.map(([x, y]) => [y, x] as LatLng);
    const first = out[0];
    const last = out[out.length - 1];
    if (out.length && first[0] === last[0] && first[1] === last[1]) out.pop();
    return out;
  };
  const r1 = toLatLng([...path1, ...segBtoA.slice(1, -1)]);
  const r2 = toLatLng([...path2, ...lineSliceCoords.slice(1, -1)]);
  const results = [r1, r2].filter((r) => r.length >= 3);
  return results.length ? results : [poly];
}

export function splitBoundary(
  boundary: LatLng[],
  lines: LatLng[][]
): LatLng[][] {
  let regions: LatLng[][] = [boundary];
  for (const line of lines) {
    regions = regions.flatMap((region) =>
      splitPolygon(region, line).filter((p) => p.length >= 3)
    );
  }
  return regions;
}
