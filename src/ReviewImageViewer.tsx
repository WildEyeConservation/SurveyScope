import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { BoundaryStatus } from '../shared/boundaryStatus';
import AnnotationWorkspace from './AnnotationWorkspace';
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
}) {
  const { width, height } = image;
  const box = useMemo(
    () => (width && height ? viewBox({ width, height }, points) : null),
    [width, height, points],
  );
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < total - 1;

  return (
    <>
      {width && height && box && (
        <AnnotationWorkspace
          key={image.id}
          embedded
          visible={visible}
          viewBoundsScale={VIEW_BOUNDS_SCALE}
          next={hasNext ? () => onStep(1) : undefined}
          prev={hasPrev ? () => onStep(-1) : undefined}
          hideZoomSetting
          hideNavButtons
          allowOutside
          bearing={bearing}
          onBearingChange={onBearingChange}
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

      <div className='absolute top-2.5 left-1/2 z-10 flex max-w-[60%] -translate-x-1/2 items-center gap-2 bg-white px-1.5 py-1 text-sm text-[#212529] shadow-lg'>
        <button
          type='button'
          aria-label='Previous image'
          disabled={!hasPrev}
          onClick={() => onStep(-1)}
          className='flex size-6 flex-none items-center justify-center bg-primary text-white disabled:opacity-40'
        >
          <ChevronLeft className='size-4' />
        </button>
        <span className='min-w-0 truncate'>
          <strong>{fileName(image.originalPath, image.id)}</strong>
          <span className='text-[#6c757d]'>
            {image.timestamp ? ` · ${formatTime(image.timestamp)}` : ''}
            {index >= 0 && ` · ${index + 1} of ${total.toLocaleString()}`}
          </span>
        </span>
        <button
          type='button'
          aria-label='Next image'
          disabled={!hasNext}
          onClick={() => onStep(1)}
          className='flex size-6 flex-none items-center justify-center bg-primary text-white disabled:opacity-40'
        >
          <ChevronRight className='size-4' />
        </button>
      </div>

      {counts.length > 0 && (
        <div className='absolute top-2.5 right-2.5 z-[4] flex max-w-56 flex-col gap-1 bg-white px-3 py-2 text-sm text-[#212529] shadow-lg'>
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
