import { loadProjectImages } from '../projectImages';
import { loadRows } from '../rowChunks';

export type ModelValue = 'scoutbotv3' | 'elephant' | 'mad' | 'owl-d';

// source is the processedBy source each model's workers write.
export const MODELS: Record<
  ModelValue,
  { label: string; source: string; status: string; setSuffix: string }
> = {
  scoutbotv3: {
    label: 'ScoutBot',
    source: 'scoutbotv3',
    status: 'processing-scoutbot',
    setSuffix: 'scoutbot',
  },
  elephant: {
    label: 'Elephant Detection Nadir',
    source: 'heatmap',
    status: 'processing-pointFinder',
    setSuffix: 'elephant-detection-nadir',
  },
  mad: {
    label: 'MAD',
    source: 'mad-v2',
    status: 'processing-mad',
    setSuffix: 'mad',
  },
  'owl-d': {
    label: 'OWL-D (Overhead Wildlife Locator)',
    source: 'owl-d',
    status: 'processing-owl-d',
    setSuffix: 'owl-d',
  },
};

export type ScanImage = { id: string; originalPath: string };

export async function findUnprocessedImages(
  client: unknown,
  projectId: string,
  source: string,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (count: number) => void } = {},
): Promise<ScanImage[]> {
  const [images, processed] = await Promise.all([
    loadProjectImages(client, projectId, ['id', 'originalPath'], {
      signal,
      onProgress,
    }),
    loadRows(
      client,
      'processedByProjectIdAndSource',
      projectId,
      ['imageId', 'source'],
      { signal, beginsWith: source },
    ),
  ]);
  const done = new Set(
    processed.filter((row) => row.source === source).map((row) => row.imageId),
  );
  return images.flatMap((image) =>
    image.originalPath && !done.has(image.id)
      ? [{ id: image.id, originalPath: image.originalPath }]
      : [],
  );
}

export async function dispatchBatches<T>(
  items: readonly T[],
  batchSize: number,
  concurrency: number,
  send: (batch: T[]) => Promise<unknown>,
): Promise<{ queued: number; error?: Error }> {
  let next = 0;
  let queued = 0;
  let error: Error | undefined;
  const worker = async () => {
    while (!error && next < items.length) {
      const batch = items.slice(next, next + batchSize);
      next += batchSize;
      try {
        await send(batch);
        queued += batch.length;
      } catch (err) {
        error ??= err instanceof Error ? err : new Error(String(err));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { queued, error };
}
