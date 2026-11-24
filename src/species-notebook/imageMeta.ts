import { selectSourceKeyForImage } from '../chain-viewer/utils/imageSourceKey';
import { onImageSessionChange } from '../StorageLayer';
import { chunk, type FieldCall } from './aliasedQuery';
import { runAliased } from './api';
import { Lru } from './lru';

export type ImageMeta = {
  id: string;
  projectId: string;
  width: number;
  height: number;
  originalPath: string | null;
  timestamp: number | null;
  boundaryStatus: string | null;
  sourceKey: string | null;
};

type ImageRow = Omit<ImageMeta, 'sourceKey'>;
type FileRow = {
  key?: string | null;
  path?: string | null;
  type?: string | null;
};

const PER_REQUEST = 15;
const cache = new Lru<Promise<ImageMeta | null>>(3000);
let queue = new Map<string, (meta: Promise<ImageMeta | null>) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

onImageSessionChange(() => cache.clear());

async function fetchBatch(
  ids: string[],
): Promise<Map<string, ImageMeta | null>> {
  const data = await runAliased(
    'SpeciesImageMeta',
    ids.flatMap((id, i): FieldCall[] => [
      {
        alias: `i${i}`,
        field: 'getImage',
        args: { id: { type: 'ID!', value: id } },
        selection:
          'id projectId width height originalPath timestamp boundaryStatus',
      },
      {
        alias: `f${i}`,
        field: 'imagesByimageId',
        args: {
          imageId: { type: 'ID!', value: id },
          limit: { type: 'Int', value: 50 },
        },
        selection: 'items { key path type }',
      },
    ]),
  );
  const out = new Map<string, ImageMeta | null>();
  ids.forEach((id, i) => {
    const image = data[`i${i}`] as ImageRow | null | undefined;
    const files = (data[`f${i}`] as { items?: FileRow[] } | null)?.items ?? [];
    out.set(
      id,
      image
        ? {
            ...image,
            sourceKey: selectSourceKeyForImage(files, image.originalPath),
          }
        : null,
    );
  });
  return out;
}

function flush() {
  timer = null;
  const batch = queue;
  queue = new Map();
  for (const ids of chunk([...batch.keys()], PER_REQUEST)) {
    const loading = fetchBatch(ids);
    for (const id of ids)
      batch.get(id)!(loading.then((all) => all.get(id) ?? null));
  }
}

// Lookups made in the same tick share requests.
export function loadImageMeta(imageId: string): Promise<ImageMeta | null> {
  const cached = cache.get(imageId);
  if (cached) return cached;
  const promise = new Promise<ImageMeta | null>((resolve, reject) => {
    queue.set(imageId, (meta) => meta.then(resolve, reject));
  });
  cache.set(imageId, promise);
  // Missing or failed lookups are asked again next time.
  const forget = () => {
    if (cache.peek(imageId) === promise) cache.delete(imageId);
  };
  promise.then((meta) => meta?.sourceKey || forget(), forget);
  timer ??= setTimeout(flush, 0);
  return promise;
}

export function primeImageMeta(imageIds: Iterable<string>) {
  for (const id of imageIds) void loadImageMeta(id).catch(() => undefined);
}
