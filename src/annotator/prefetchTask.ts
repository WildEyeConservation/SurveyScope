import {
  getTileBlob,
  imageTileContext,
  primeImageTiles,
} from '../StorageLayer';
import type { AnnotationTaskPayload } from '../annotationTypes';
import { tileLoadStats } from '../storage/tileLoadStats';
import { isAbort, makeLimiter } from '../storage/tilePackReader';
import { loadImageFiles, sourceKeyOf } from './useImageFileSource';
import { viewTiles } from './viewTiles';

let viewport = { width: 0, height: 0 };

export function setAnnotatorViewport(width: number, height: number) {
  if (width > 0 && height > 0) viewport = { width, height };
}

const currentViewport = () =>
  viewport.width > 0
    ? viewport
    : { width: window.innerWidth, height: window.innerHeight };

type Client = Parameters<typeof loadImageFiles>[0];

// One task at a time so warming never crowds out the task on screen.
const warming = makeLimiter(1);

export function prefetchTask(
  client: Client,
  task: {
    location: Omit<AnnotationTaskPayload['location'], 'annotationSetId'>;
    zoom?: number | null;
    viewBoundsScale?: number;
    viewport?: { width: number; height: number };
  },
  signal?: AbortSignal,
): Promise<void> {
  return warming
    .run(async () => {
      const { image, id: taskId } = task.location;
      if (taskId) tileLoadStats.markPrefetched(taskId);
      const key = sourceKeyOf(await loadImageFiles(client, image.id, taskId));
      if (!key || signal?.aborted) return;
      const context = imageTileContext(image, taskId);
      const tiles = viewTiles({
        image,
        location: task.location,
        zoom: task.zoom,
        viewBoundsScale: task.viewBoundsScale,
        viewport: task.viewport ?? currentViewport(),
      });
      await Promise.all(
        tiles.map(({ z, row, col }) =>
          getTileBlob(`slippymaps/${key}/${z}/${row}/${col}.png`, context),
        ),
      );
    }, signal)
    .catch((error: unknown) => {
      if (isAbort(error)) return;
      console.warn('Prefetching a task failed', error);
    });
}

// Signing and headers are a few KB, so every received task gets them early.
export function primeTask(
  client: Client,
  location: AnnotationTaskPayload['location'],
): Promise<void> {
  const { image, id: taskId } = location;
  return loadImageFiles(client, image.id, taskId)
    .then((files) => {
      const key = sourceKeyOf(files);
      if (key) return primeImageTiles(key, imageTileContext(image, taskId));
    })
    .catch((error: unknown) => {
      console.warn('Priming a task failed', error);
    });
}
