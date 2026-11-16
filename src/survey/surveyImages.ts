import { createContext, useContext } from 'react';
import type { BoundaryStatus } from '../../shared/boundaryStatus';
import { loadProjectImages, type ImageRow } from '../projectImages';
import { fetchAllPaginatedResults } from '../utils';
import { makeRetrying } from './retryOps';
import { subscribeSurveySaves, surveySavesCompleted } from './surveySaves';

const FIELDS = [
  'cameraId',
  'transectId',
  'boundaryStatus',
  'originalPath',
  'latitude',
  'longitude',
  'altitude_agl',
  'altitude_wgs84',
  'width',
  'height',
  'timestamp',
] as const;

export type SurveyImageRow = Omit<
  ImageRow<(typeof FIELDS)[number]>,
  'boundaryStatus'
> & { boundaryStatus: BoundaryStatus | null };

export type LoadSurveyImages = (options?: {
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
}) => Promise<SurveyImageRow[]>;

export type SurveyImages = {
  load: LoadSurveyImages;
  // Refetch after writing image fields outside a survey save.
  refresh: () => void;
};

export type SurveyImagesStore = SurveyImages & { open: () => () => void };

const REPLACED = Symbol('replaced');

function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

// One fetch per open modal, shared by the tabs: leaving a tab only detaches it.
export function createSurveyImagesStore(
  client: unknown,
  projectId: string,
): SurveyImagesStore {
  let controller: AbortController | null = null;
  let rows: Promise<SurveyImageRow[]> | null = null;
  let closed = false;
  let failed = false;
  let saves = 0;
  let loaded = 0;
  const progress = new Set<(count: number) => void>();
  let replace = () => {};
  let replaced = new Promise<typeof REPLACED>(
    (resolve) => (replace = () => resolve(REPLACED)),
  );

  const report = (count: number) => {
    loaded = count;
    progress.forEach((listener) => listener(count));
  };

  const start = () => {
    controller?.abort();
    replace();
    replaced = new Promise((resolve) => (replace = () => resolve(REPLACED)));
    const current = new AbortController();
    const { signal } = current;
    controller = current;
    saves = surveySavesCompleted(projectId);
    failed = false;
    report(0);
    const models = (client as { models: { Image: Record<string, unknown> } })
      .models;
    const onProgress = (count: number) => {
      if (!signal.aborted) report(count);
    };
    rows = loadProjectImages(client, projectId, FIELDS, {
      signal,
      onProgress,
      fallback: () =>
        fetchAllPaginatedResults(
          makeRetrying(models.Image.imagesByProjectId, signal),
          { projectId, selectionSet: ['id', ...FIELDS], limit: 10000 },
          onProgress,
        ),
    }) as Promise<SurveyImageRow[]>;
    rows.catch(() => {
      if (controller === current) failed = true;
    });
  };

  // Starts lazily: tabs' effects run before the provider's.
  const ensureFresh = () => {
    if (closed) return;
    if (!rows || failed || saves !== surveySavesCompleted(projectId)) start();
  };

  return {
    open() {
      closed = false;
      ensureFresh();
      const unsubscribe = subscribeSurveySaves(ensureFresh);
      return () => {
        unsubscribe();
        closed = true;
        controller?.abort();
        rows = null;
      };
    },
    refresh() {
      if (!closed) start();
    },
    async load({ signal, onProgress } = {}) {
      if (onProgress) {
        onProgress(loaded);
        progress.add(onProgress);
      }
      try {
        for (;;) {
          ensureFresh();
          const current = rows;
          if (!current) throw new Error('Survey images are not open');
          try {
            const result = await untilAborted(
              Promise.race([current, replaced]),
              signal,
            );
            if (result !== REPLACED) return result;
          } catch (error) {
            if (signal?.aborted || current === rows) throw error;
          }
        }
      } finally {
        if (onProgress) progress.delete(onProgress);
      }
    },
  };
}

export const SurveyImagesContext = createContext<SurveyImages | null>(null);

export function useSurveyImages(): SurveyImages {
  const store = useContext(SurveyImagesContext);
  if (!store) throw new Error('useSurveyImages needs a SurveyImagesProvider');
  return store;
}
