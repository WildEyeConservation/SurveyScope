import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { Size } from '../shared/testTileBounds';
import { startTest } from './api/tasks';
import { GlobalContext, ProjectContext } from './Context';
import type { Identifiable } from './TaskBuffer';

export type TileSample = { tile: Size; image: Size };
// Set in jobs whose tests are grown to a tile; answers no sample while unknown.
export type TileSource = () => TileSample | undefined;

// The server picks each test, so the browser never sees the pool of answers.
export default function useTesting(
  growRef?: MutableRefObject<TileSource | undefined>,
) {
  const { currentPM, project } = useContext(ProjectContext)!;
  const { client } = useContext(GlobalContext)!;

  const [zoom, setZoom] = useState<number | undefined>(undefined);
  const setupPromiseRef = useRef<Promise<void>>(Promise.resolve());
  // Tests are answered with this set's labels.
  const jobSetIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    async function setup() {
      jobSetIdRef.current = undefined;
      if (!currentPM.queueId) return;
      const { data: queue } = await client.models.Queue.get({
        id: currentPM.queueId,
      });
      if (queue?.zoom) setZoom(queue.zoom);
      jobSetIdRef.current = queue?.annotationSetId ?? undefined;
    }
    setupPromiseRef.current = setup();
  }, [currentPM]);

  const fetcher = useCallback(async (): Promise<Identifiable | null> => {
    await setupPromiseRef.current;
    const jobAnnotationSetId = jobSetIdRef.current;
    if (!jobAnnotationSetId) return null;
    const grow = growRef?.current;
    const tile = grow?.();
    if (grow && !tile) return null;
    const started = await startTest({
      projectId: project.id,
      jobAnnotationSetId,
      ...(tile ? { tile } : {}),
    });
    if (!started) return null;

    const id = crypto.randomUUID();
    return {
      id,
      message_id: id,
      location: {
        id: started.location.id,
        annotationSetId: started.annotationSetId,
      },
      allowOutside: true,
      taskTag: '',
      skipLocationWithAnnotations: false,
      zoom,
      testPresetId: started.testPresetId,
      testLeaseId: started.leaseId,
      testBox: started.grown ? started.box : undefined,
      testContext: started.context,
      ack: () => {},
      isTest: true,
    } as Identifiable;
  }, [growRef, project.id, zoom]);

  return { fetcher };
}
