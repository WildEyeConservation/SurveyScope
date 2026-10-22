import * as turf from '@turf/turf';
import type {
  Feature,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';
import { simplifyPolygonToRange } from '../../utils/shapefileUtils';
import { createBoundaryClassifier } from '../../../shared/boundaryStatus';
import type { StrataNetwork } from '../strataNetwork';

// Rings are open and ordered [lat, lng].
export type LatLng = [number, number];

export type AreaRole = 'boundary' | 'exclusion' | 'ignore';

export interface SurveyArea {
  boundary: LatLng[] | null;
  exclusions: LatLng[][];
  // Null keeps strata saved before networks were stored.
  network?: StrataNetwork | null;
}

export const EMPTY_AREA: SurveyArea = { boundary: null, exclusions: [] };

export interface ImportedPolygon {
  id: string;
  name: string;
  source: string;
  ring: LatLng[];
  areaKm2: number;
  role: AreaRole;
}

type LngLat = [number, number];
type PolygonFeature = Feature<Polygon>;
type AreaFeature = Feature<Polygon | MultiPolygon>;

const NAME_KEYS = ['name', 'Name', 'NAME', 'label', 'Label', 'title', 'id'];

// Drops consecutive duplicates and the closing point; axis order is kept.
function openRing<T extends [number, number]>(coords: T[]): T[] {
  const ring: T[] = [];
  for (const point of coords) {
    const prev = ring[ring.length - 1];
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) ring.push(point);
  }
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  return ring;
}

const toLngLat = ([lat, lng]: LatLng): LngLat => [lng, lat];
const toLatLng = ([lng, lat]: LngLat): LatLng => [lat, lng];

export function ringToPolygon(ring: LatLng[]): PolygonFeature | null {
  const coords = openRing(ring).map(toLngLat);
  if (coords.length < 3) return null;
  return turf.polygon([[...coords, coords[0]]]);
}

export function ringAreaKm2(ring: LatLng[]): number {
  const polygon = ringToPolygon(ring);
  return polygon ? turf.area(polygon) / 1e6 : 0;
}

type Named = { geometry: Geometry; properties: unknown };

function collectGeometries(value: unknown, out: Named[], properties?: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) collectGeometries(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as {
    type?: string;
    features?: unknown[];
    geometry?: unknown;
    geometries?: unknown[];
    properties?: unknown;
  };
  if (node.type === 'FeatureCollection') {
    for (const feature of node.features ?? []) collectGeometries(feature, out);
  } else if (node.type === 'Feature') {
    collectGeometries(node.geometry, out, node.properties);
  } else if (node.type === 'GeometryCollection') {
    for (const geometry of node.geometries ?? []) {
      collectGeometries(geometry, out, properties);
    }
  } else if (node.type === 'Polygon' || node.type === 'MultiPolygon') {
    out.push({ geometry: value as Geometry, properties });
  }
}

function featureName(properties: unknown): string | null {
  if (!properties || typeof properties !== 'object') return null;
  for (const key of NAME_KEYS) {
    const value = (properties as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

// GeoJSON holes become separate exclusion candidates.
export function polygonsFromGeoJson(
  geojson: unknown,
  source: string
): Omit<ImportedPolygon, 'role'>[] {
  const found: Named[] = [];
  collectGeometries(geojson, found);
  const polygons: Omit<ImportedPolygon, 'role'>[] = [];
  for (const { geometry, properties } of found) {
    const parts: Position[][][] =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
    const baseName = featureName(properties);
    for (const rings of parts) {
      (rings ?? []).forEach((rawRing, ringIndex) => {
        const lngLat = (rawRing ?? []).map(
          (position): LngLat => [Number(position[0]), Number(position[1])]
        );
        for (const [lng, lat] of lngLat) {
          if (
            !Number.isFinite(lng) ||
            !Number.isFinite(lat) ||
            Math.abs(lng) > 180 ||
            Math.abs(lat) > 90
          ) {
            throw new Error(
              `${source} is not in latitude/longitude (WGS84) coordinates.`
            );
          }
        }
        const open = openRing(lngLat);
        if (open.length < 3) return;
        const simplified = simplifyPolygonToRange([...open, open[0]]);
        const ring = openRing(simplified).map(toLatLng);
        if (ring.length < 3) return;
        const number = polygons.length + 1;
        const name = baseName ?? `Polygon ${number}`;
        polygons.push({
          id: `${source}:${number}`,
          name: ringIndex === 0 ? name : `${name} (hole ${ringIndex})`,
          source,
          ring,
          areaKm2: ringAreaKm2(ring),
        });
      });
    }
  }
  return polygons;
}

function insidePolygon(
  point: { lat: number; lng: number },
  polygon: AreaFeature
) {
  return turf.booleanPointInPolygon([point.lng, point.lat], polygon);
}

function ringInside(ring: LatLng[], container: PolygonFeature): boolean {
  const polygon = ringToPolygon(ring);
  if (!polygon) return false;
  const [lng, lat] = turf.pointOnFeature(polygon).geometry.coordinates;
  return insidePolygon({ lat, lng }, container);
}

const ROLE_SAMPLE_SIZE = 5000;
const MAX_EXCLUSION_AREA_SHARE = 0.5;
const MAX_EXCLUSION_IMAGE_SHARE = 0.2;

// Prefer image coverage, breaking ties by area.
export function suggestRoles(
  polygons: Omit<ImportedPolygon, 'role'>[],
  points: { lat: number; lng: number }[],
  existingBoundary: LatLng[] | null
): ImportedPolygon[] {
  const stride = Math.max(1, Math.ceil(points.length / ROLE_SAMPLE_SIZE));
  const sample = points.filter((_, index) => index % stride === 0);
  const counted = polygons.map((polygon) => {
    const feature = ringToPolygon(polygon.ring);
    const count = feature
      ? sample.filter((point) => insidePolygon(point, feature)).length
      : 0;
    return { polygon, feature, count };
  });

  let boundary = existingBoundary ? ringToPolygon(existingBoundary) : null;
  let boundaryId: string | null = null;
  if (!boundary) {
    let best: (typeof counted)[number] | null = null;
    for (const candidate of counted) {
      if (!candidate.feature) continue;
      if (
        !best ||
        candidate.count > best.count ||
        (candidate.count === best.count &&
          candidate.polygon.areaKm2 > best.polygon.areaKm2)
      ) {
        best = candidate;
      }
    }
    boundary = best?.feature ?? null;
    boundaryId = best?.polygon.id ?? null;
  }
  const boundaryKm2 = boundary ? turf.area(boundary) / 1e6 : 0;

  return counted.map(({ polygon, count }) => ({
    ...polygon,
    role:
      polygon.id === boundaryId
        ? 'boundary'
        : boundary &&
          polygon.areaKm2 < boundaryKm2 * MAX_EXCLUSION_AREA_SHARE &&
          count <= sample.length * MAX_EXCLUSION_IMAGE_SHARE &&
          ringInside(polygon.ring, boundary)
        ? 'exclusion'
        : 'ignore',
  }));
}

export function setImportRole(
  polygons: ImportedPolygon[],
  id: string,
  role: AreaRole
): ImportedPolygon[] {
  return polygons.map((polygon) => {
    if (polygon.id === id) return { ...polygon, role };
    if (role === 'boundary' && polygon.role === 'boundary') {
      return { ...polygon, role: 'ignore' };
    }
    return polygon;
  });
}

export function applyImport(
  area: SurveyArea,
  polygons: ImportedPolygon[]
): SurveyArea {
  const boundary = polygons.find((polygon) => polygon.role === 'boundary');
  return {
    ...area,
    boundary: boundary ? boundary.ring : area.boundary,
    exclusions: [
      ...area.exclusions,
      ...polygons
        .filter((polygon) => polygon.role === 'exclusion')
        .map((polygon) => polygon.ring),
    ],
  };
}

// Unplaced rows are left to GPS validation.
export function outsideAreaKeys<T extends { lat: number; lng: number }>(
  rows: T[],
  boundary: LatLng[] | null,
  marginM: number,
  keyOf: (row: T) => string
): Set<string> {
  const outside = new Set<string>();
  if (!boundary) return outside;
  const classify = createBoundaryClassifier({
    boundary,
    exclusions: [],
    marginM,
  });
  for (const row of rows) {
    if (classify(row.lat, row.lng) === 'outside') outside.add(keyOf(row));
  }
  return outside;
}

export function pruneOutsideArea<
  T extends { originalPath: string; latitude: number; longitude: number }
>(
  images: T[],
  boundary: LatLng[] | null,
  marginM: number,
  keepPaths: Set<string>
): T[] {
  const outside = outsideAreaKeys(
    images.map((image) => ({
      lat: image.latitude,
      lng: image.longitude,
      path: image.originalPath,
    })),
    boundary,
    marginM,
    (row) => row.path
  );
  return images.filter(
    (image) =>
      keepPaths.has(image.originalPath) || !outside.has(image.originalPath)
  );
}

const TRACE_MARGIN_M = 250;

export function traceAroundPoints(
  points: { lat: number; lng: number }[],
  marginM = TRACE_MARGIN_M
): LatLng[] | null {
  const valid = points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)
  );
  if (valid.length === 0) return null;
  const collection = turf.featureCollection(
    valid.map((point) => turf.point([point.lng, point.lat]))
  );
  // Collinear or single positions have no hull; buffer their extent instead.
  const base =
    turf.convex(collection) ?? turf.bboxPolygon(turf.bbox(collection));
  const buffered = turf.buffer(base, marginM, { units: 'meters' });
  const geometry = buffered?.geometry;
  if (!geometry) return null;
  const outer = (
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.coordinates[0]?.[0]
  ) as LngLat[] | undefined;
  if (!outer) return null;
  const ring = openRing(outer).map(toLatLng);
  return ring.length >= 3 ? ring : null;
}
