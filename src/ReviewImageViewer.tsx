import { useMemo } from 'react';
import type { BoundaryStatus } from '../shared/boundaryStatus';
import type {
  NeighbourImageLookup,
  OtherViewsHandler,
  ViewerFocus,
} from './annotationTypes';
import AnnotationWorkspace from './AnnotationWorkspace';
import { ImageStepper } from './ImageStepper';
import {
  fileName,
  formatTime,
  type Point,
  VIEW_BOUNDS_SCALE,
  viewBox,
  type ViewerCount,
  type ViewerImage,
} from './reviewImageView';

export default function ReviewImageViewer({
  image,
  annotationSetId,
  points,
  index,
  total,
  counts,
  onStep,
  visible,
  bearing,
  onBearingChange,
  otherViews,
  neighbourOverlaps,
  focus,
  rightInset = 0,
}: {
  image: ViewerImage;
  annotationSetId: string;
  points: Point[];
  index: number;
  total: number;
  counts: ViewerCount[];
  onStep: (delta: number) => void;
  visible: boolean;
  bearing?: number;
  onBearingChange?: (bearing: number) => void;
  otherViews?: OtherViewsHandler;
  neighbourOverlaps?: NeighbourImageLookup;
  focus?: ViewerFocus;
  rightInset?: number;
}) {
  const { width, height } = image;
  const box = useMemo(() => {
    if (!width || !height) return null;
    if (!focus) return viewBox({ width, height }, points);
    const side = Math.min(width, height) / 4;
    return { x: focus.x, y: focus.y, width: side, height: side };
  }, [width, height, points, focus]);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < total - 1;

  return (
    <>
      {width && height && box && (
        <AnnotationWorkspace
          key={image.id}
          embedded
          clickToCreate={false}
          visible={visible}
          viewBoundsScale={VIEW_BOUNDS_SCALE}
          next={hasNext ? () => onStep(1) : undefined}
          prev={hasPrev ? () => onStep(-1) : undefined}
          hideZoomSetting
          hideNavButtons
          allowOutside
          bearing={bearing}
          onBearingChange={onBearingChange}
          otherViews={otherViews}
          neighbourOverlaps={neighbourOverlaps}
          focus={focus}
          location={{
            image: {
              id: image.id,
              width,
              height,
              boundaryStatus: image.boundaryStatus as BoundaryStatus | null,
            },
            annotationSetId,
            ...box,
          }}
        />
      )}

      <ImageStepper
        title={fileName(image.originalPath, image.id)}
        detail={image.timestamp ? formatTime(image.timestamp) : null}
        index={index}
        total={total}
        onStep={onStep}
      />

      {counts.length > 0 && (
        <div
          className='absolute top-2.5 z-[4] flex max-w-56 flex-col gap-1 bg-white px-3 py-2 text-sm text-[#212529] shadow-lg'
          style={{ right: 10 + rightInset }}
        >
          <span className='text-[10px] font-semibold tracking-wider text-[#6c757d] uppercase'>
            This image
          </span>
          {counts.map(({ key, label, color, count }) => (
            <span key={key} className='flex items-baseline gap-2'>
              <span
                className='size-2.5 flex-none'
                style={{ backgroundColor: color }}
              />
              {count} {label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
