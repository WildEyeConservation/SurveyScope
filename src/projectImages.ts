import {
  decodeManifest,
  type ManifestChunk,
  type ManifestField,
  type ManifestRow,
} from '../shared/imageManifest';
import { fetchAllPaginatedResults } from './utils';

type ChunkQuery = (
  input: { projectId: string; cursor?: string; fields: string[] },
  options: { signal?: AbortSignal }
) => Promise<{ data?: unknown; errors?: { message?: string }[] }>;

interface ChunkPage {
  data: string;
  count: number;
  cursor: string | null;
}

export interface LoadImagesOptions {
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
  fallback?: () => Promise<unknown[]>;
}

// Resolved at runtime because the generated client may predate this query.
function resolveChunkQuery(client: unknown): ChunkQuery | undefined {
  const queries = (client as { queries?: Record<string, unknown> }).queries;
  const query = queries?.getImageManifestChunk;
  return typeof query === 'function' ? (query as ChunkQuery) : undefined;
}

async function gunzipJson(base64: string): Promise<ManifestChunk> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

export async function fetchImageManifest<F extends ManifestField>(
  client: unknown,
  projectId: string,
  fields: readonly F[],
  { signal, onProgress }: LoadImagesOptions = {}
): Promise<ManifestRow<F>[] | null> {
  const query = resolveChunkQuery(client);
  if (!query) return null;

  const images: ManifestRow<F>[] = [];
  let cursor: string | null = null;
  do {
    const { data, errors } = await query(
      { projectId, cursor: cursor ?? undefined, fields: [...fields] },
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
    if (!page) throw new Error('Empty image manifest response');
    const chunk = await gunzipJson(page.data);
    signal?.throwIfAborted();
    for (const image of decodeManifest(chunk)) {
      images.push(image);
    }
    onProgress?.(images.length);
    cursor = page.cursor;
  } while (cursor);
  return images;
}

export async function loadProjectImages<F extends ManifestField>(
  client: unknown,
  projectId: string,
  fields: readonly F[],
  options: LoadImagesOptions = {}
): Promise<ManifestRow<F>[]> {
  const { signal, onProgress, fallback } = options;
  const manifest = await fetchImageManifest(
    client,
    projectId,
    fields,
    options
  ).catch((error) => {
    if (signal?.aborted) throw error;
    console.warn('Image manifest failed, paginating instead', error);
    return null;
  });
  if (manifest) return manifest;
  const images = fallback
    ? await fallback()
    : await fetchAllPaginatedResults(
        (client as { models: { Image: { imagesByProjectId: never } } }).models
          .Image.imagesByProjectId,
        {
          projectId,
          selectionSet: ['id', ...fields],
          limit: 10000,
          signal,
        },
        onProgress
      );
  return images as ManifestRow<F>[];
}
