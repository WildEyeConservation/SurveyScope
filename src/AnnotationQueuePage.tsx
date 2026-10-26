import { useState } from 'react';
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

  return (
    <div
      className='flex flex-col items-center gap-4 w-full h-full'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      <div className='w-full h-full'>
        {fetcher && (
          <TaskBuffer
            index={index}
            setIndex={setIndex}
            fetcher={fetcher}
            standbyFetcher={standbyTestFetcher}
            standbyN={2}
            beforeNext={beforeNext}
            visible
            preloadN={3}
            historyN={2}
            renderTask={(task) => <AnnotationWorkspace {...task} />}
          />
        )}
      </div>
      <JobsRemaining />
    </div>
  );
}
