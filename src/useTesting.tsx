import { useCallback, useContext, useEffect, useState } from 'react';
import { startTest } from './api/tasks';
import { GlobalContext, ProjectContext } from './Context';
import type { Identifiable } from './TaskBuffer';

// The server picks each test for the queue, sizes it to the queue's tiles and
// serves one only when it is due.
export default function useTesting() {
  const { currentPM, project } = useContext(ProjectContext)!;
  const { client } = useContext(GlobalContext)!;
  const [zoom, setZoom] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!currentPM.queueId) return;
    client.models.Queue.get({ id: currentPM.queueId }).then(({ data }) =>
      setZoom(data?.zoom ?? undefined),
    );
  }, [client, currentPM.queueId]);

  const fetcher = useCallback(
    async (dueQueueId?: string): Promise<Identifiable | null> => {
      const queueId = dueQueueId ?? currentPM.queueId;
      if (!queueId) return null;
      const started = await startTest({ projectId: project.id, queueId });
      if (!started) return null;

      return {
        id: started.leaseId,
        message_id: started.leaseId,
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
    },
    [currentPM.queueId, project.id, zoom],
  );

  return { fetcher };
}
