import { decodeRows, type RowChunk } from '../shared/rowChunk';
import {
  chunkFields,
  ROW_SOURCES,
  type FieldOf,
  type RowOf,
  type RowSource,
  type RowSourceName,
} from '../shared/rowSources';
import { fetchAllPaginatedResults } from './utils';

type ChunkQuery = (
  input: {
    source: string;
    scopeId: string;
    fields: string[];
    beginsWith?: string;
    cursor?: string;
  },
  options: { signal?: AbortSignal }
) => Promise<{ data?: unknown; errors?: { message?: string }[] }>;

interface ChunkPage {
  data: string;
  count: number;
  cursor: string | null;
}

export interface RowQueryOptions {
  signal?: AbortSignal;
  // Prefix of the source's sort key, e.g. a detector name.
  beginsWith?: string;
}

export interface LoadRowsOptions extends RowQueryOptions {
  onProgress?: (count: number) => void;
  fallback?: () => Promise<unknown[]>;
}

// Resolved at runtime because the generated client may predate this query.
function resolveChunkQuery(client: unknown): ChunkQuery | undefined {
  const queries = (client as { queries?: Record<string, unknown> }).queries;
  const query = queries?.getRowChunk;
  return typeof query === 'function' ? (query as ChunkQuery) : undefined;
}

async function gunzipJson(base64: string): Promise<RowChunk> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

// Resolves false when the deployed API has no chunk query.
export async function forEachRowChunk<
  S extends RowSourceName,
  F extends FieldOf<S>
>(
  client: unknown,
  source: S,
  scopeId: string,
  fields: readonly F[],
  onRows: (rows: RowOf<S, F>[]) => void,
  { signal, beginsWith }: RowQueryOptions = {}
): Promise<boolean> {
  const query = resolveChunkQuery(client);
  if (!query) return false;
  const { fields: kinds } = ROW_SOURCES[source] as RowSource;
  let cursor: string | null = null;
  do {
    const { data, errors } = await query(
      {
        source,
        scopeId,
        fields: [...fields],
        ...(beginsWith === undefined ? {} : { beginsWith }),
        cursor: cursor ?? undefined,
      },
      { signal }
    );
    if (errors?.length) {
      throw new Error(
        errors.map((entry) => entry.message ?? 'Unknown error').join('; ')
      );
    }
    const page = (typeof data === 'string' ? JSON.parse(data) : data) as
      | ChunkPage
      | undefined;
    if (!page) throw new Error(`Empty ${source} chunk response`);
    const chunk = await gunzipJson(page.data);
    signal?.throwIfAborted();
    onRows(decodeRows(chunk, kinds) as RowOf<S, F>[]);
    cursor = page.cursor;
  } while (cursor);
  return true;
}

function paginate(
  client: unknown,
  name: RowSourceName,
  scopeId: string,
  fields: readonly string[],
  { signal, beginsWith }: RowQueryOptions,
  onProgress?: (count: number) => void
): Promise<unknown[]> {
  const source = ROW_SOURCES[name] as RowSource;
  const models = (client as { models: Record<string, Record<string, never>> })
    .models;
  return fetchAllPaginatedResults(
    models[source.model][name],
    {
      [source.partitionKey]: scopeId,
      ...(beginsWith !== undefined && source.sortKey
        ? { [source.sortKey]: { beginsWith } }
        : {}),
      selectionSet: chunkFields(source, fields),
      limit: 10000,
      signal,
    },
    onProgress
  );
}

export async function loadRows<S extends RowSourceName, F extends FieldOf<S>>(
  client: unknown,
  source: S,
  scopeId: string,
  fields: readonly F[],
  options: LoadRowsOptions = {}
): Promise<RowOf<S, F>[]> {
  const { signal, onProgress, fallback } = options;
  const rows: RowOf<S, F>[] = [];
  try {
    const loaded = await forEachRowChunk(
      client,
      source,
      scopeId,
      fields,
      (page) => {
        for (const row of page) rows.push(row);
        onProgress?.(rows.length);
      },
      options
    );
    if (loaded) return rows;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`${source} chunks failed, paginating instead`, error);
  }
  const fallbackRows = fallback
    ? await fallback()
    : await paginate(client, source, scopeId, fields, options, onProgress);
  return fallbackRows as RowOf<S, F>[];
}

// Falling back after delivery would duplicate rows.
export async function streamRows<S extends RowSourceName, F extends FieldOf<S>>(
  client: unknown,
  source: S,
  scopeId: string,
  fields: readonly F[],
  onRows: (rows: RowOf<S, F>[]) => void,
  options: RowQueryOptions & {
    fallback: (onRows: (rows: RowOf<S, F>[]) => void) => Promise<void>;
  }
): Promise<void> {
  let delivered = false;
  try {
    const loaded = await forEachRowChunk(
      client,
      source,
      scopeId,
      fields,
      (rows) => {
        delivered = true;
        onRows(rows);
      },
      options
    );
    if (loaded) return;
  } catch (error) {
    if (options.signal?.aborted || delivered) throw error;
    console.warn(`${source} chunks failed, paginating instead`, error);
  }
  await options.fallback(onRows);
}
