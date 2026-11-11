import { loadRows } from '../rowChunks';
import type { LoadSurveyImages } from './surveyImages';

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

export async function findUnprocessedByModel(
  client: unknown,
  projectId: string,
  models: readonly ModelValue[],
  loadImages: LoadSurveyImages,
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (count: number) => void } = {},
): Promise<{ total: number; unprocessed: Record<string, ScanImage[]> }> {
  const [images, ...processed] = await Promise.all([
    loadImages({ signal, onProgress }),
    ...models.map((model) =>
      loadRows(
        client,
        'processedByProjectIdAndSource',
        projectId,
        ['imageId', 'source'],
        { signal, beginsWith: MODELS[model].source },
      ),
    ),
  ]);
  const scannable = images.flatMap((image) =>
    image.originalPath
      ? [{ id: image.id, originalPath: image.originalPath }]
      : [],
  );
  const unprocessed: Record<string, ScanImage[]> = {};
  models.forEach((model, i) => {
    const source = MODELS[model].source;
    const done = new Set(
      processed[i]
        .filter((row) => row.source === source)
        .map((row) => row.imageId),
    );
    unprocessed[model] = scannable.filter((image) => !done.has(image.id));
  });
  return { total: scannable.length, unprocessed };
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
