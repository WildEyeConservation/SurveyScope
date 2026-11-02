import {
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { useParams } from 'react-router-dom';
import { storedDefaultZoom } from './defaultZoomEvents';
import { GlobalContext } from './Context';
import {
  ANNOTATION_PRELOAD,
  prefetchPlanner,
} from './annotator/prefetchPlanner';
import { prefetchTask } from './annotator/prefetchTask';
import type { AnnotationTaskPayload } from './annotationTypes';
import { JobsRemaining } from './JobsRemaining';
import AnnotationWorkspace from './AnnotationWorkspace';
import { TaskBuffer } from './TaskBuffer';
import useAnnotationTaskQueue from './useAnnotationTaskQueue';
import useUnsavedWorkGuard from './useUnsavedWorkGuard';

/*
The annotation route: obtains fully hydrated annotation tasks, keeps nearby
tasks mounted for instant navigation, and shows the queue/session totals.
*/
export default function AnnotationQueuePage() {
  const [index, setIndex] = useState(0);
  const { fetcher, standbyTestFetcher, beforeNext } =
    useAnnotationTaskQueue();
  useUnsavedWorkGuard();
  const { client } = useContext(GlobalContext)!;
  const { surveyId } = useParams();
  useEffect(() => prefetchPlanner.skipNext(), []);
  const prefetch = useSyncExternalStore(
    prefetchPlanner.subscribe,
    prefetchPlanner.depth
  );
  // Same precedence as AnnotationWorkspace, so warmed tiles match the view.
  const warm = useCallback(
    (task: AnnotationTaskPayload) =>
      void prefetchTask(
        client as unknown as Parameters<typeof prefetchTask>[0],
        {
          ...task,
          zoom: storedDefaultZoom(surveyId) ?? task.zoom,
        }
      ),
    [client, surveyId]
  );

  return (
    <div
      className='d-flex flex-column align-items-center gap-3 w-100 h-100'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      <div className='w-100 h-100'>
        {fetcher && (
          <TaskBuffer
            index={index}
            setIndex={setIndex}
            fetcher={fetcher}
            standbyFetcher={standbyTestFetcher}
            standbyN={2}
            beforeNext={beforeNext}
            visible
            preloadN={ANNOTATION_PRELOAD}
            prefetch={prefetch}
            warm={warm}
            historyN={2}
            renderTask={(task) => <AnnotationWorkspace {...task} />}
          />
        )}
      </div>
      <JobsRemaining />
    </div>
  );
}
