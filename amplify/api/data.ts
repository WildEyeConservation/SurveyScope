import { env } from '$amplify/env/api';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { AccessStore } from './access';
import type { DataLayer, QueryOptions, Result } from './models';
import type { Introspection, Row } from './schema';
import type { LeaseTable } from './taskStore';

type Operation = (...args: unknown[]) => Promise<{
  data: unknown;
  nextToken?: string | null;
  errors?: unknown[];
}>;
type LooseClient = {
  models: Record<string, Record<string, Operation>>;
  queries: Record<string, Operation>;
  mutations: Record<string, Operation>;
};

let setup:
  Promise<{ client: LooseClient; introspection: Introspection }> | undefined;

export function amplifyData() {
  setup ??= (async () => {
    const { resourceConfig, libraryOptions } =
      await getAmplifyDataClientConfig(env);
    Amplify.configure(resourceConfig, libraryOptions);
    return {
      client: generateClient() as unknown as LooseClient,
      introspection: resourceConfig.API.GraphQL
        .modelIntrospection as Introspection,
    };
  })().catch((error) => {
    setup = undefined;
    throw error;
  });
  return setup;
}

const selection = (options: QueryOptions) =>
  options.selectionSet ? { selectionSet: options.selectionSet } : undefined;

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

export class AmplifyDataLayer implements DataLayer {
  constructor(private readonly client: LooseClient) {}

  private model(name: string) {
    const model = this.client.models[name];
    if (!model) throw new Error(`Unknown model ${name}`);
    return model;
  }

  private async call<T>(promise: ReturnType<Operation>): Promise<Result<T>> {
    const result = await promise;
    return {
      data: plain(result.data) as T,
      nextToken: result.nextToken ?? null,
      ...(result.errors?.length ? { errors: result.errors } : {}),
    };
  }

  get(model: string, key: Row, options: QueryOptions) {
    return this.call<Row | null>(
      this.model(model).get(key, selection(options)),
    );
  }

  list(model: string, options: QueryOptions) {
    return this.call<Row[]>(this.model(model).list(options));
  }

  query(model: string, field: string, input: Row, options: QueryOptions) {
    const query = this.model(model)[field];
    if (!query) throw new Error(`Unknown query ${model}.${field}`);
    return this.call<Row[]>(query(input, options));
  }

  create(model: string, input: Row, options: QueryOptions) {
    return this.call<Row | null>(
      this.model(model).create(input, selection(options)),
    );
  }

  update(model: string, input: Row, options: QueryOptions) {
    return this.call<Row | null>(
      this.model(model).update(input, selection(options)),
    );
  }

  delete(model: string, key: Row, options: QueryOptions) {
    return this.call<Row | null>(
      this.model(model).delete(key, selection(options)),
    );
  }
}

async function all<T>(
  page: (nextToken: string | null) => ReturnType<Operation>,
): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null = null;
  do {
    const result = await page(nextToken);
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    items.push(...((result.data as T[]) ?? []));
    nextToken = result.nextToken ?? null;
  } while (nextToken);
  return items;
}

// Shared across requests in a container. Only grants are kept, so new access is seen at once.
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();

function kept(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await load();
  if (kept(value)) {
    if (cache.size > 5000) cache.clear();
    cache.set(key, { at: Date.now(), value });
  } else cache.delete(key);
  return value;
}

export class AmplifyAccessStore implements AccessStore {
  constructor(
    private readonly client: LooseClient,
    private readonly leases: LeaseTable,
  ) {}

  activeLeases(userId: string) {
    return this.leases.active(userId);
  }

  memberProjectIds(userId: string) {
    return cached(`memberProjects:${userId}`, async () => {
      const rows = await all<{ projectId: string }>((nextToken) =>
        this.client.models.UserProjectMembership.userProjectMembershipsByUserId(
          { userId },
          { selectionSet: ['projectId'], nextToken },
        ),
      );
      return [...new Set(rows.map((r) => r.projectId))];
    });
  }

  presetIdsOfProject(projectId: string) {
    return cached(`presets:${projectId}`, async () => {
      const rows = await all<{ testPresetId: string }>((nextToken) =>
        this.client.models.TestPresetProject.testPresetsByProjectId(
          { projectId },
          { selectionSet: ['testPresetId'], nextToken },
        ),
      );
      return rows.map((r) => r.testPresetId);
    });
  }

  presetLocations(presetId: string) {
    return cached(`presetLocations:${presetId}`, async () => {
      return all<{ locationId: string; annotationSetId: string }>((nextToken) =>
        this.client.models.TestPresetLocation.locationsByTestPresetId(
          { testPresetId: presetId },
          { selectionSet: ['locationId', 'annotationSetId'], nextToken },
        ),
      );
    });
  }

  neighbours(imageId: string) {
    return cached(`neighbours:${imageId}`, async () => {
      const [left, right] = await Promise.all(
        (
          ['imageNeighboursByImage1key', 'imageNeighboursByImage2key'] as const
        ).map((query) =>
          all<{ image1Id: string; image2Id: string }>((nextToken) =>
            this.client.models.ImageNeighbour[query](
              query === 'imageNeighboursByImage1key'
                ? { image1Id: imageId }
                : { image2Id: imageId },
              { selectionSet: ['image1Id', 'image2Id'], nextToken },
            ),
          ),
        ),
      );
      return [...left, ...right];
    });
  }

  organizationMembership(organizationId: string, userId: string) {
    return cached(`orgMember:${organizationId}:${userId}`, async () => {
      const result = await this.client.models.OrganizationMembership.get(
        { organizationId, userId },
        { selectionSet: ['organizationId', 'userId', 'isAdmin'] },
      );
      if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
      return result.data as { isAdmin?: boolean | null } | null;
    });
  }

  organizationIds(userId: string) {
    return cached(`orgIds:${userId}`, async () => {
      const memberships = await all<{ organizationId: string }>((nextToken) =>
        this.client.models.OrganizationMembership.organizationsByUserId(
          { userId },
          { selectionSet: ['organizationId'], nextToken },
        ),
      );
      return memberships.map((m) => m.organizationId);
    });
  }

  project(id: string) {
    return cached(`project:${id}`, async () => {
      const result = await this.client.models.Project.get(
        { id },
        { selectionSet: ['id', 'organizationId'] },
      );
      if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
      return result.data as { id: string; organizationId: string } | null;
    });
  }

  projectMemberships(userId: string, projectId: string) {
    return cached(`projectMembers:${userId}:${projectId}`, async () => {
      return all<{ isAdmin?: boolean | null }>((nextToken) =>
        this.client.models.UserProjectMembership.userProjectMembershipsByUserId(
          { userId },
          {
            filter: { projectId: { eq: projectId } },
            selectionSet: ['id', 'isAdmin'],
            nextToken,
          },
        ),
      );
    });
  }

  resultsMemberships(surveyId: string, userId: string) {
    return cached(`results:${surveyId}:${userId}`, async () => {
      return all<{ annotationSetId: string }>((nextToken) =>
        this.client.models.JollyResultsMembership.jollyResultsMembershipsBySurveyId(
          { surveyId },
          {
            filter: { userId: { eq: userId } },
            selectionSet: ['annotationSetId'],
            nextToken,
          },
        ),
      );
    });
  }
}
