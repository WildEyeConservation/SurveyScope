import {
  decodeManifest,
  type ManifestChunk,
  type ManifestImage,
} from '../../shared/imageManifest';

type ChunkQuery = (
  input: { projectId: string; cursor?: string },
  options: { signal?: AbortSignal }
) => Promise<{ data?: unknown; errors?: { message?: string }[] }>;

interface ChunkPage {
  data: string;
  count: number;
  cursor: string | null;
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

export async function fetchImageManifest(
  client: unknown,
  projectId: string,
  signal?: AbortSignal
): Promise<ManifestImage[] | null> {
  const query = resolveChunkQuery(client);
  if (!query) return null;

  const images: ManifestImage[] = [];
  let cursor: string | null = null;
  do {
    const { data, errors } = await query(
      { projectId, cursor: cursor ?? undefined },
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
    cursor = page.cursor;
  } while (cursor);
  return images;
}
