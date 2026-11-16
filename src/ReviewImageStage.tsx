import { useContext, useEffect, type HTMLAttributes } from 'react';
import { GlobalContext } from './Context';
import ReviewImageViewer from './ReviewImageViewer';
import {
  warmImage,
  type Point,
  type ViewerCount,
  type ViewerImage,
} from './reviewImageView';

export type StageSlot = {
  image: ViewerImage;
  points: Point[];
  counts: ViewerCount[];
};

// Keep neighbouring viewers mounted to avoid loading delays when stepping.
const MOUNTED = [-1, 1, 2];
const WARMED = [3, 4, 5, -2];
const WARM_DELAY_MS = 300;

export default function ReviewImageStage({
  ids,
  currentId,
  lookup,
  annotationSetId,
  visible,
  buffer,
  onStep,
  bearingFor,
  onBearingChange,
}: {
  ids: string[];
  currentId: string;
  lookup: (id: string) => StageSlot | null;
  annotationSetId: string;
  visible: boolean;
  buffer: boolean;
  onStep: (delta: number) => void;
  bearingFor?: (id: string) => number;
  onBearingChange?: (id: string, bearing: number) => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const index = ids.indexOf(currentId);

  useEffect(() => {
    if (!visible || !buffer || index < 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      for (const offset of WARMED) {
        const id = ids[index + offset];
        const slot = id ? lookup(id) : null;
        if (slot) warmImage(client, slot.image, slot.points, controller.signal);
      }
    }, WARM_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, visible, buffer, index, ids, lookup]);

  const mounted = [currentId];
  if (buffer && index >= 0)
    for (const offset of MOUNTED) {
      const id = ids[index + offset];
      if (id) mounted.push(id);
    }

  return (
    <>
      {mounted.map((id) => {
        const slot = lookup(id);
        if (!slot) return null;
        const isCurrent = id === currentId;
        // inert must be omitted, not false; React 18 has no typing for it.
        const inertProps = (
          isCurrent ? {} : { inert: '' }
        ) as HTMLAttributes<HTMLDivElement>;
        return (
          <div
            key={id}
            className='absolute inset-0'
            {...inertProps}
            style={{
              visibility: isCurrent ? undefined : 'hidden',
              pointerEvents: isCurrent ? undefined : 'none',
            }}
          >
            <ReviewImageViewer
              image={slot.image}
              annotationSetId={annotationSetId}
              points={slot.points}
              index={ids.indexOf(id)}
              total={ids.length}
              counts={slot.counts}
              onStep={onStep}
              visible={visible && isCurrent}
              bearing={bearingFor?.(id)}
              onBearingChange={
                onBearingChange && ((bearing) => onBearingChange(id, bearing))
              }
            />
          </div>
        );
      })}
    </>
  );
}
