import React, { useState, useEffect, useContext, useRef } from 'react';
import { UserContext } from './Context';
import {
  insertBufferedTaskAfter,
  promoteStandbyTaskAfter,
} from './taskBufferSequence';

export type TaskPayload = object;

export type Identifiable = TaskPayload & {
  id: string;
};

export type FetcherType<T extends TaskPayload = TaskPayload> = () => Promise<T>;

export type BeforeNextDecision<T extends TaskPayload> =
  | { kind: 'insert'; task: T }
  | { kind: 'promote-standby'; overrides?: Partial<T> }
  | null
  | undefined;

/** Props TaskBuffer injects into each buffered task when rendering it. */
export type BufferedTaskProps<T extends TaskPayload = TaskPayload> = T & {
  id: string;
  visible: boolean;
  next?: () => void;
  prev?: () => void;
};

interface TaskBufferProps<T extends TaskPayload> {
  fetcher: FetcherType<T>;
  index: number;
  setIndex: (index: number | ((prevState: number) => number)) => void;
  historyN?: number;
  preloadN?: number;
  visible?: boolean;
  prefetch?: number;
  /** Fetches tasks reserved outside the normal queue. The first stays mounted and warm. */
  standbyFetcher?: () => Promise<T | null | undefined>;
  standbyN?: number;
  /** Optionally inserts an urgent task or promotes the warmed standby task. */
  beforeNext?: (
    task: T & { id: string },
    index: number,
    context: { standbyReady: boolean }
  ) => Promise<BeforeNextDecision<T>>;
  /** Renders one buffered task. Receives the fetched task fields plus navigation props. */
  renderTask: (task: BufferedTaskProps<T>) => React.ReactNode;
}

/*
TaskBuffer keeps a window of tasks around the current index: it fetches
ahead (preloadN) so the next task is ready before the user pages to it, and
keeps recent tasks mounted (historyN) so paging back is instant. All buffered
tasks stay mounted but only the current one is visible.
*/
export function TaskBuffer<T extends TaskPayload>({
  historyN = 2,
  preloadN = 3,
  fetcher,
  visible = true,
  index,
  setIndex,
  prefetch = 0,
  standbyFetcher,
  standbyN = 0,
  beforeNext,
  renderTask,
}: TaskBufferProps<T>) {
  const [buffer, setBuffer] = useState<Array<T & { id: string }>>([]);
  const [standbyBuffer, setStandbyBuffer] = useState<
    Array<T & { id: string }>
  >([]);
  const [waitingCount, setWaitingCount] = useState<number>(0);
  const advancingRef = useRef(false);
  const { setJobsCompleted } = useContext(UserContext)!;

  useEffect(() => {
    if (
      index >
      buffer.length + Math.max(waitingCount, 0) - preloadN - 1 - prefetch
    ) {
      setWaitingCount((wc) => wc + 1);
      fetcher()
        .then((props) => {
          if (props) {
            setBuffer((b) => [...b, { ...props, id: crypto.randomUUID() }]);
          }
        })
        .catch((error) => {
          console.error('Task fetch failed', error);
        })
        .finally(() => {
          setWaitingCount((wc) => wc - 1);
        });
    }
    // Refill only when navigation or a completed fetch changes the buffer.
    // A new render-time fetcher identity must not enqueue duplicate work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer.length, index]);

  // Fill one slot at a time. The first entry is rendered invisibly so its
  // queries, image and MapLibre instance are ready; remaining entries are
  // hydrated payloads ready to become the next hot standby.
  useEffect(() => {
    if (!standbyFetcher || standbyBuffer.length >= standbyN) return;

    let cancelled = false;
    standbyFetcher()
      .then((props) => {
        if (!cancelled && props) {
          setStandbyBuffer((current) => {
            if (current.length >= standbyN) return current;
            return [...current, { ...props, id: crypto.randomUUID() }];
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Standby task fetch failed', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [standbyBuffer.length, standbyFetcher, standbyN]);

  const subsetStart = Math.max(index - historyN, 0);
  const subset = buffer.slice(subsetStart, index + preloadN);
  if (!subset.length) {
    return null;
  }

  const renderedEntries: Array<{
    entry: T & { id: string };
    subsetIndex: number;
    isStandby: boolean;
  }> = subset.map((entry, subsetIndex) => ({
    entry,
    subsetIndex,
    isStandby: false,
  }));
  const hotStandby = standbyBuffer[0];
  if (
    hotStandby &&
    !renderedEntries.some(({ entry }) => entry.id === hotStandby.id)
  ) {
    renderedEntries.push({
      entry: hotStandby,
      subsetIndex: -1,
      isStandby: true,
    });
  }

  return (
    <div className='w-100 h-100' style={{ position: 'relative' }}>
      {renderedEntries.map(({ entry, subsetIndex, isStandby }) => {
        const isCurrent =
          !isStandby && subsetIndex === index - subsetStart;
        /*
        `inert` rather than aria-hidden. Clicking "Next Location" leaves DOM
        focus on that button, and a browser refuses to apply aria-hidden to an
        ancestor of the focused element — it logs "Blocked aria-hidden on an
        element because its descendant retained focus" and ignores the
        attribute, so the off-screen tasks stayed exposed to assistive
        technology anyway. inert hides the subtree *and* pulls focus out of it,
        which is what a buffered task that is no longer on screen wants.

        It has to be omitted rather than set to false: inert is a boolean
        attribute, so inert="false" would still make the subtree inert. React 18
        has no typing for it either, hence the cast.
        */
        const inertProps = (
          isCurrent ? {} : { inert: '' }
        ) as React.HTMLAttributes<HTMLDivElement>;
        return (
          <div
            key={entry.id}
            className='d-flex justify-content-center w-100 h-100'
            {...inertProps}
            style={{
              visibility: isCurrent ? 'visible' : 'hidden',
              position: 'absolute',
              top: 0,
              left: '50%',
              transform: 'translateX(-50%)',
              pointerEvents: isCurrent ? undefined : 'none',
            }}
          >
            {renderTask({
              ...entry,
              visible: visible && isCurrent,
              next:
                !isStandby && subsetIndex < subset.length - 1
                  ? async () => {
                      if (advancingRef.current) return;
                      advancingRef.current = true;
                      try {
                        const decision = beforeNext
                          ? await beforeNext(entry, index, {
                              standbyReady: standbyBuffer.length > 0,
                            })
                          : null;
                        if (decision?.kind === 'insert') {
                          setBuffer((currentBuffer) =>
                            insertBufferedTaskAfter(
                              currentBuffer,
                              index,
                              decision.task,
                              crypto.randomUUID()
                            )
                          );
                        } else if (
                          decision?.kind === 'promote-standby' &&
                          standbyBuffer[0]
                        ) {
                          const currentHotStandby = standbyBuffer[0];
                          setBuffer((currentBuffer) =>
                            promoteStandbyTaskAfter(
                              currentBuffer,
                              index,
                              currentHotStandby,
                              decision.overrides
                            )
                          );
                          setStandbyBuffer((current) => current.slice(1));
                        }
                        setJobsCompleted((x) => x + 1);
                        setIndex((currentIndex) => currentIndex + 1);
                      } catch (error) {
                        console.error('Failed to prepare the next task', error);
                        setJobsCompleted((x) => x + 1);
                        setIndex((currentIndex) => currentIndex + 1);
                      } finally {
                        advancingRef.current = false;
                      }
                    }
                  : undefined,
              prev:
                !isStandby && subsetIndex > 0
                  ? () => {
                      setJobsCompleted((x) => x - 1);
                      setIndex((index) => index - 1);
                    }
                  : undefined,
            })}
          </div>
        );
      })}
    </div>
  );
}
