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
  })();
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

export class AmplifyAccessStore implements AccessStore {
  constructor(
    private readonly client: LooseClient,
    private readonly leases: LeaseTable,
  ) {}

  activeLeases(userId: string) {
    return this.leases.active(userId);
  }

  async memberProjectIds(userId: string) {
    const rows = await all<{ projectId: string }>((nextToken) =>
      this.client.models.UserProjectMembership.userProjectMembershipsByUserId(
        { userId },
        { selectionSet: ['projectId'], nextToken },
      ),
    );
    return [...new Set(rows.map((r) => r.projectId))];
  }

  async presetIdsOfProject(projectId: string) {
    const rows = await all<{ testPresetId: string }>((nextToken) =>
      this.client.models.TestPresetProject.testPresetsByProjectId(
        { projectId },
        { selectionSet: ['testPresetId'], nextToken },
      ),
    );
    return rows.map((r) => r.testPresetId);
  }

  presetLocations(presetId: string) {
    return all<{ locationId: string; annotationSetId: string }>((nextToken) =>
      this.client.models.TestPresetLocation.locationsByTestPresetId(
        { testPresetId: presetId },
        { selectionSet: ['locationId', 'annotationSetId'], nextToken },
      ),
    );
  }

  async neighbours(imageId: string) {
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
  }

  async organizationMembership(organizationId: string, userId: string) {
    const result = await this.client.models.OrganizationMembership.get(
      { organizationId, userId },
      { selectionSet: ['organizationId', 'userId', 'isAdmin'] },
    );
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    return result.data as { isAdmin?: boolean | null } | null;
  }

  async organizationIds(userId: string) {
    const memberships = await all<{ organizationId: string }>((nextToken) =>
      this.client.models.OrganizationMembership.organizationsByUserId(
        { userId },
        { selectionSet: ['organizationId'], nextToken },
      ),
    );
    return memberships.map((m) => m.organizationId);
  }

  async project(id: string) {
    const result = await this.client.models.Project.get(
      { id },
      { selectionSet: ['id', 'organizationId'] },
    );
    if (result.errors?.length) throw new Error(JSON.stringify(result.errors));
    return result.data as { id: string; organizationId: string } | null;
  }

  projectMemberships(userId: string, projectId: string) {
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
  }

  resultsMemberships(surveyId: string, userId: string) {
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
  }
}
