import type { SurveyArea } from './new-survey/surveyArea';
import {
  EMPTY_NETWORK,
  strataSections,
  type LatLng,
  type StrataLayout,
  type StrataNetwork,
} from './strataNetwork';
import {
  carryStrata,
  loadStrata,
  type NamedStratum,
  type SavedStratum,
} from './transectStrata';

type Result<T> = { data?: T | null; errors?: unknown[] | null };

export type ProjectStrataFields = {
  strataNetwork?: unknown;
  boundaryRecomputeRequested?: boolean | null;
  boundaryRecomputeLeaseUntil?: string | null;
};

export type StrataClient = {
  models: {
    Stratum: {
      create(input: {
        projectId: string;
        name: string;
        coordinates: number[];
        group?: string;
      }): Promise<Result<{ id: string }>>;
      update(input: {
        id: string;
        name: string;
        coordinates?: number[];
      }): Promise<Result<unknown>>;
      delete(input: { id: string }): Promise<Result<unknown>>;
    };
    Project: {
      get(
        key: { id: string },
        options: { selectionSet: string[] },
        request?: { signal?: AbortSignal }
      ): Promise<Result<ProjectStrataFields>>;
      update(input: {
        id: string;
        strataNetwork: string;
      }): Promise<Result<unknown>>;
    };
  };
};

// Amplify resolves failed requests with an errors array instead of rejecting.
function unwrap<T>(result: Result<T>) {
  if (result?.errors?.length) {
    throw new Error(`Request failed: ${JSON.stringify(result.errors)}`);
  }
  return result?.data ?? null;
}

const SAME_POINT_DEG = 1e-7;

// Rotation, direction and float noise do not change a shape.
export function sameShape(a: LatLng[], b: LatLng[]): boolean {
  const near = (p: LatLng, ring: LatLng[]) =>
    ring.some(
      (q) =>
        Math.abs(p[0] - q[0]) <= SAME_POINT_DEG &&
        Math.abs(p[1] - q[1]) <= SAME_POINT_DEG
    );
  const open = (ring: LatLng[]) =>
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  const [x, y] = [open(a), open(b)];
  return (
    x.length === y.length &&
    x.every((p) => near(p, y)) &&
    y.every((p) => near(p, x))
  );
}

export function sameStrata(a: NamedStratum[], b: NamedStratum[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (st, i) =>
        st.id === b[i].id &&
        st.name.trim() === b[i].name.trim() &&
        sameShape(st.coords, b[i].coords)
    )
  );
}

export function parseNetwork(value: unknown): StrataNetwork | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)) {
      return parsed as StrataNetwork;
    }
  } catch {
    /* treated as no network */
  }
  return null;
}

// Without a stored network, one saved stratum is the whole boundary.
export function initialNetwork(
  stored: StrataNetwork | null,
  strata: SavedStratum[]
): StrataNetwork | null {
  return stored ?? (strata.length > 1 ? null : EMPTY_NETWORK);
}

// A null network shows strata saved before networks were stored.
export function layoutOf(
  area: SurveyArea,
  legacy: SavedStratum[]
): StrataLayout {
  if (area.network === null) {
    return { sections: legacy.map((st) => st.coords), dangling: false };
  }
  return strataSections(area.boundary, area.network ?? EMPTY_NETWORK);
}

export async function loadProjectStrata(
  client: StrataClient,
  projectId: string,
  signal?: AbortSignal
): Promise<ProjectStrataFields> {
  return (
    unwrap(
      await client.models.Project.get(
        { id: projectId },
        {
          selectionSet: [
            'strataNetwork',
            'boundaryRecomputeRequested',
            'boundaryRecomputeLeaseUntil',
          ],
        },
        { signal }
      )
    ) ?? {}
  );
}

export async function saveNetwork(
  client: StrataClient,
  projectId: string,
  network: StrataNetwork
) {
  unwrap(
    await client.models.Project.update({
      id: projectId,
      strataNetwork: JSON.stringify(network),
    })
  );
}

export function strataReshaped(
  named: NamedStratum[],
  previous: SavedStratum[]
): boolean {
  const before = new Map(previous.map((st) => [st.id, st]));
  const kept = new Set(named.map((st) => st.id));
  return (
    previous.some((st) => !kept.has(st.id)) ||
    named.some((st) => {
      const old = st.id ? before.get(st.id) : undefined;
      return !old || !sameShape(old.coords, st.coords);
    })
  );
}

export async function saveStrataRows(
  client: StrataClient,
  projectId: string,
  group: string | undefined,
  named: NamedStratum[],
  previous: SavedStratum[]
): Promise<SavedStratum[]> {
  const before = new Map(previous.map((st) => [st.id, st]));
  const strata: SavedStratum[] = [];
  for (const st of named) {
    const name = st.name.trim();
    const old = st.id ? before.get(st.id) : undefined;
    if (old) {
      const moved = !sameShape(old.coords, st.coords);
      if (old.name !== name || moved) {
        unwrap(
          await client.models.Stratum.update({
            id: old.id,
            name,
            ...(moved && { coordinates: st.coords.flat() }),
          })
        );
      }
      strata.push({ id: old.id, name, coords: moved ? st.coords : old.coords });
    } else {
      const data = unwrap(
        await client.models.Stratum.create({
          projectId,
          name,
          coordinates: st.coords.flat(),
          group,
        })
      );
      if (!data) throw new Error('The stratum was not created');
      strata.push({ id: data.id, name, coords: st.coords });
    }
  }
  const kept = new Set(strata.map((st) => st.id));
  for (const result of await Promise.all(
    previous
      .filter((st) => !kept.has(st.id))
      .map((st) => client.models.Stratum.delete({ id: st.id }))
  )) {
    unwrap(result);
  }
  return strata;
}

export async function resplitStrata(
  client: StrataClient,
  projectId: string,
  area: SurveyArea,
  group: string | undefined
) {
  const [strata, project] = await Promise.all([
    loadStrata(client as never, projectId),
    loadProjectStrata(client, projectId),
  ]);
  const stored = parseNetwork(project.strataNetwork);
  // Legacy strata cannot follow a new boundary, so they become one again.
  const network = initialNetwork(stored, strata) ?? EMPTY_NETWORK;
  if (!stored) await saveNetwork(client, projectId, network);
  const { sections } = strataSections(area.boundary, network);
  await saveStrataRows(
    client,
    projectId,
    group,
    carryStrata(sections, strata),
    strata
  );
}
