import { getTileBlob, imageTileContext } from '../StorageLayer';
import { makeLimiter } from '../storage/tilePackReader';
import { tileLoadStats } from '../storage/tileLoadStats';
import type { AnnotationTaskPayload } from '../annotationTypes';
import { viewTiles } from './viewTiles';
import { loadImageFiles, sourceKeyOf } from './useImageFileSource';

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
  task: Pick<AnnotationTaskPayload, 'location' | 'zoom'>
): Promise<void> {
  return warming
    .run(async () => {
      const { image, id: taskId } = task.location;
      if (taskId) tileLoadStats.markPrefetched(taskId);
      const key = sourceKeyOf(await loadImageFiles(client, image.id, taskId));
      if (!key) return;
      const context = imageTileContext(image, taskId);
      const tiles = viewTiles({
        image,
        location: task.location,
        zoom: task.zoom,
        viewport: currentViewport(),
      });
      await Promise.all(
        tiles.map(({ z, row, col }) =>
          getTileBlob(`slippymaps/${key}/${z}/${row}/${col}.png`, context)
        )
      );
    })
    .catch((error: unknown) => {
      console.warn('Prefetching a task failed', error);
    });
}
