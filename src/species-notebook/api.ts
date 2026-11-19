import { generateClient } from 'aws-amplify/api';
import { runWithClientLimit } from '../limitedClient';
import { buildAliasedQuery, chunk, type FieldCall } from './aliasedQuery';

const client = generateClient({ authMode: 'userPool' });

type Page<T> = { items?: (T | null)[] | null; nextToken?: string | null };
type GraphQLResponse = {
  data?: Record<string, unknown> | null;
  errors?: { message?: string }[];
};

export async function runAliased(
  name: string,
  calls: FieldCall[],
): Promise<Record<string, unknown>> {
  if (calls.length === 0) return {};
  const { query, variables } = buildAliasedQuery(name, calls);
  let response: GraphQLResponse;
  try {
    response = (await runWithClientLimit(
      () => client.graphql({ query, variables }) as Promise<unknown>,
    )) as GraphQLResponse;
  } catch (error) {
    // Amplify throws on any error; keep the aliases that did resolve.
    const partial = error as GraphQLResponse;
    if (!partial?.data) throw error;
    response = partial;
  }
  if (!response.data && response.errors?.length) {
    throw new Error(response.errors.map((e) => e.message).join('; '));
  }
  return response.data ?? {};
}

export type PagedCall = Omit<FieldCall, 'selection'> & {
  itemFields: string;
  pageSize: number;
  max: number;
};

export async function fetchPagedAliased<T>(
  name: string,
  calls: PagedCall[],
  perRequest = 20,
): Promise<Map<string, { items: T[]; complete: boolean }>> {
  const results = new Map<string, { items: T[]; complete: boolean }>();
  const tokens = new Map<string, string | null>();
  for (const call of calls)
    results.set(call.alias, { items: [], complete: false });
  let active = calls;
  while (active.length > 0) {
    const rounds = await Promise.all(
      chunk(active, perRequest).map((group) =>
        runAliased(
          name,
          group.map((call) => ({
            alias: call.alias,
            field: call.field,
            args: {
              ...call.args,
              limit: { type: 'Int', value: call.pageSize },
              nextToken: { type: 'String', value: tokens.get(call.alias) },
            },
            selection: `items { ${call.itemFields} } nextToken`,
          })),
        ),
      ),
    );
    const data = Object.assign({}, ...rounds) as Record<string, Page<T> | null>;
    const next: PagedCall[] = [];
    for (const call of active) {
      const result = results.get(call.alias)!;
      const page = data[call.alias];
      for (const item of page?.items ?? []) if (item) result.items.push(item);
      const token = page?.nextToken ?? null;
      if (token && result.items.length < call.max) {
        tokens.set(call.alias, token);
        next.push(call);
      } else {
        result.complete = !token;
      }
    }
    active = next;
  }
  return results;
}
