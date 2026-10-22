import * as turf from '@turf/turf';
import type { DataClient } from '../../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from '../utils';
import { isOnEffort } from '../../shared/boundaryStatus';
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

type PolygonFeature = NonNullable<ReturnType<typeof ringToPolygon>>;

function intersectArea(a: PolygonFeature, b: PolygonFeature): number {
  const shared = turf.intersect(turf.featureCollection([a, b]));
  return shared ? turf.area(shared) : 0;
}

// Near-degenerate rings can make clipping throw.
function overlapArea(a: PolygonFeature, b: PolygonFeature): number {
  try {
    return intersectArea(a, b);
  } catch {
    try {
      const round = (f: PolygonFeature) =>
        turf.cleanCoords(turf.truncate(f, { precision: 7 }));
      return intersectArea(round(a), round(b));
    } catch {
      const inside =
        turf.booleanPointInPolygon(turf.pointOnFeature(a), b) ||
        turf.booleanPointInPolygon(turf.pointOnFeature(b), a);
      return inside ? Math.min(turf.area(a), turf.area(b)) : 0;
    }
  }
}

export type NamedStratum = { id?: string; name: string; coords: LatLng[] };

// New sections keep the id of the previous stratum they mostly cover.
export function carryStrata(
  sections: LatLng[][],
  previous: NamedStratum[]
): NamedStratum[] {
  const polys = sections.map(ringToPolygon);
  const prevPolys = previous.map((st) => ringToPolygon(st.coords));
  const pairs: { i: number; j: number; overlap: number }[] = [];
  polys.forEach((a, i) =>
    prevPolys.forEach((b, j) => {
      if (!a || !b) return;
      const overlap = overlapArea(a, b);
      if (overlap > 0.5 * Math.min(turf.area(a), turf.area(b))) {
        pairs.push({ i, j, overlap });
      }
    })
  );
  pairs.sort((p, q) => q.overlap - p.overlap);
  const matched = new Map<number, number>();
  const taken = new Set<number>();
  for (const { i, j } of pairs) {
    if (matched.has(i) || taken.has(j)) continue;
    matched.set(i, j);
    taken.add(j);
  }
  // Default names follow the list order; typed names stay with their area.
  const isDefault = (name: string) => /^Stratum \d+$/.test(name.trim());
  const used = new Set(
    [...matched.values()]
      .map((j) => previous[j].name)
      .filter((name) => !isDefault(name))
  );
  let next = 1;
  return sections.map((coords, i) => {
    const j = matched.get(i);
    const kept = j === undefined ? undefined : previous[j];
    if (kept && !isDefault(kept.name)) return { ...kept, coords };
    while (used.has(`Stratum ${next}`)) next++;
    used.add(`Stratum ${next}`);
    return { ...(kept && { id: kept.id }), name: `Stratum ${next}`, coords };
  });
}
