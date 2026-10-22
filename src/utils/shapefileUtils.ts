import * as turf from '@turf/turf';
import type { SurveyArea } from '../survey/new-survey/surveyArea';

export type LatLngTuple = [number, number];

// Adaptive simplification: keep vertices between minPoints and maxPoints
export function simplifyPolygonToRange(
  rawLonLat: [number, number][],
  minPoints = 1000,
  maxPoints = 1500
): [number, number][] {
  if (rawLonLat.length <= minPoints) return rawLonLat;
  let tolerance = 1e-6;
  let coords: [number, number][] = rawLonLat;
  while (true) {
    const simplified = turf.simplify(turf.polygon([coords]), { tolerance });
    const simplifiedCoords = simplified.geometry.coordinates[0] as [
      number,
      number
    ][];
    coords = simplifiedCoords;
    if (coords.length <= maxPoints || tolerance > 1) {
      break;
    }
    tolerance *= 2;
  }
  return coords;
}

// Ensure the linear ring is closed (first equals last)
export function ensureClosedRing(
  coords: [number, number][]
): [number, number][] {
  if (
    coords.length &&
    (coords[0][0] !== coords[coords.length - 1][0] ||
      coords[0][1] !== coords[coords.length - 1][1])
  ) {
    return [...coords, coords[0]];
  }
  return coords;
}

// Create or update the shapefile for a project using [lat, lng] tuples
export async function saveShapefileForProject(
  client: any,
  projectId: string,
  latLngs: LatLngTuple[],
  group: string | undefined,
  marginM?: number
): Promise<void> {
  if (!latLngs || latLngs.length === 0) return;

  // Convert [lat,lng] -> [lng,lat]
  const lonLat: [number, number][] = latLngs.map(([lat, lng]) => [lng, lat]);
  const closed = ensureClosedRing(lonLat);
  const simplifiedLonLat = simplifyPolygonToRange(closed);

  // Flatten back to [lat, lng] numeric array for storage
  const flattened: number[] = [];
  simplifiedLonLat.forEach(([lng, lat]) => {
    flattened.push(lat, lng);
  });

  // create vs update
  const existing = unwrap<Array<{ id: string }>>(
    await client.models.Shapefile.shapefilesByProjectId({ projectId })
  );
  if (existing && existing.length > 0) {
    unwrap(
      await client.models.Shapefile.update({
        id: existing[0].id,
        coordinates: flattened,
        ...(marginM === undefined ? {} : { marginM }),
      })
    );
  } else {
    unwrap(
      await client.models.Shapefile.create({
        projectId,
        coordinates: flattened,
        marginM: marginM ?? 0,
        group,
      })
    );
  }
}

// Amplify resolves failed requests with an errors array instead of rejecting.
function unwrap<T>(result: { data?: T | null; errors?: unknown[] | null }) {
  if (result?.errors?.length) {
    throw new Error(
      `Survey area request failed: ${JSON.stringify(result.errors)}`
    );
  }
  return result?.data ?? null;
}

function unflatten(coordinates: (number | null)[] | null): LatLngTuple[] {
  const flat = (coordinates ?? []).filter((n): n is number => n != null);
  const ring: LatLngTuple[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    ring.push([flat[i], flat[i + 1]]);
  }
  return ring;
}

type StoredRing = {
  id: string;
  coordinates: (number | null)[] | null;
  marginM?: number | null;
};

export async function loadSurveyArea(
  client: any,
  projectId: string,
  signal?: AbortSignal
): Promise<SurveyArea & { marginM: number | null }> {
  const [boundaryResult, exclusionResult] = await Promise.all([
    client.models.Shapefile.shapefilesByProjectId({ projectId }, { signal }),
    client.models.ShapefileExclusions.shapefileExclusionsByProjectId(
      { projectId },
      { signal }
    ),
  ]);
  const stored = unwrap<StoredRing[]>(boundaryResult)?.[0];
  const boundary = unflatten(stored?.coordinates ?? null);
  const exclusions = (unwrap<StoredRing[]>(exclusionResult) ?? [])
    .map((item) => unflatten(item.coordinates))
    .filter((ring) => ring.length >= 3);
  return {
    boundary: boundary.length >= 3 ? boundary : null,
    exclusions,
    // Null for boundaries saved before the margin was stored.
    marginM:
      typeof stored?.marginM === 'number' ? Math.max(0, stored.marginM) : null,
  };
}

export async function saveExclusionsForProject(
  client: any,
  projectId: string,
  exclusions: LatLngTuple[][],
  group: string | undefined
): Promise<void> {
  const existing =
    unwrap<StoredRing[]>(
      await client.models.ShapefileExclusions.shapefileExclusionsByProjectId({
        projectId,
      })
    ) ?? [];
  for (const result of await Promise.all(
    existing.map((exclusion) =>
      client.models.ShapefileExclusions.delete({ id: exclusion.id })
    )
  )) {
    unwrap(result);
  }
  for (const result of await Promise.all(
    exclusions.map((ring) =>
      client.models.ShapefileExclusions.create({
        projectId,
        coordinates: ring.flat(),
        group,
      })
    )
  )) {
    unwrap(result);
  }
}

export async function saveSurveyArea(
  client: any,
  projectId: string,
  area: SurveyArea,
  group: string | undefined,
  marginM?: number
): Promise<void> {
  if (area.boundary && area.boundary.length >= 3) {
    await saveShapefileForProject(
      client,
      projectId,
      area.boundary,
      group,
      marginM
    );
  } else {
    const existing =
      unwrap<StoredRing[]>(
        await client.models.Shapefile.shapefilesByProjectId({ projectId })
      ) ?? [];
    for (const result of await Promise.all(
      existing.map((shapefile) =>
        client.models.Shapefile.delete({ id: shapefile.id })
      )
    )) {
      unwrap(result);
    }
  }
  await saveExclusionsForProject(client, projectId, area.exclusions, group);
}

type DataResult = { data?: unknown; errors?: unknown[] | null };
type RecomputeClient = {
  models: {
    Project: {
      update(input: {
        id: string;
        boundaryRecomputeRequested: boolean;
      }): Promise<DataResult>;
    };
  };
  mutations: {
    recomputeBoundaryStatus(args: { projectId: string }): Promise<DataResult>;
  };
};

export async function recomputeBoundaryStatus(
  client: RecomputeClient,
  projectId: string
): Promise<void> {
  unwrap(
    await client.models.Project.update({
      id: projectId,
      boundaryRecomputeRequested: true,
    })
  );
  try {
    unwrap(await client.mutations.recomputeBoundaryStatus({ projectId }));
  } catch (err) {
    await client.models.Project.update({
      id: projectId,
      boundaryRecomputeRequested: false,
    });
    throw err;
  }
}

export { boundaryRecomputePending } from '../../shared/boundaryStatus';
