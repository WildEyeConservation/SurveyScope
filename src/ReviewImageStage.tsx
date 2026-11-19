import {
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import type {
  NeighbourImageLookup,
  OtherViewsHandler,
  ViewerFocus,
} from './annotationTypes';
import { GlobalContext } from './Context';
import {
  warmImage,
  type Point,
  type ViewerCount,
  type ViewerImage,
} from './reviewImageView';
import ReviewImageViewer from './ReviewImageViewer';

export type StageSlot = {
  image: ViewerImage;
  points: Point[];
  counts: ViewerCount[];
  annotationSetId?: string;
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
  otherViews,
  neighbourOverlaps,
  focusFor,
  rightInset,
  wrapSlot,
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
  otherViews?: OtherViewsHandler;
  neighbourOverlaps?: NeighbourImageLookup;
  focusFor?: (id: string) => ViewerFocus | undefined;
  rightInset?: number;
  wrapSlot?: (id: string, viewer: ReactNode) => ReactNode;
}) {
  const { client } = useContext(GlobalContext)!;
  const index = ids.indexOf(currentId);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;

  // Keyed on the ids themselves so edits that rebuild the list don't rewarm.
  const warmKey =
    index < 0
      ? ''
      : WARMED.map((offset) => ids[index + offset] ?? '')
          .filter(Boolean)
          .join(',');
  useEffect(() => {
    if (!visible || !buffer || !warmKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      for (const id of warmKey.split(',')) {
        const slot = lookupRef.current(id);
        if (slot) warmImage(client, slot.image, slot.points, controller.signal);
      }
    }, WARM_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, visible, buffer, warmKey]);

  const wrap = wrapSlot ?? ((_id: string, viewer: ReactNode) => viewer);
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
            {wrap(
              id,
              <ReviewImageViewer
                image={slot.image}
                annotationSetId={slot.annotationSetId ?? annotationSetId}
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
                otherViews={otherViews}
                neighbourOverlaps={neighbourOverlaps}
                focus={focusFor?.(id)}
                rightInset={rightInset}
              />,
            )}
          </div>
        );
      })}
    </>
  );
}
