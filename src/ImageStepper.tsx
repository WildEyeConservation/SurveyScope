import { ChevronLeft, ChevronRight } from 'lucide-react';

// The pill over image viewers that names the image and steps through the list.
export function ImageStepper({
  title,
  detail,
  index,
  total,
  onStep,
}: {
  title: string;
  detail?: string | null;
  index: number;
  total: number;
  onStep: (delta: number) => void;
}) {
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < total - 1;
  return (
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
        <strong>{title}</strong>
        <span className='text-[#6c757d]'>
          {detail ? ` · ${detail}` : ''}
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
  );
}
