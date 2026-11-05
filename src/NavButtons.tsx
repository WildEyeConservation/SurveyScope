import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Forward and backward navigation buttons rendered under the annotation view.
 * @component
 * @property {function} next Callback to call when next button is clicked. If undefined, the button is disabled.
 * @property {function} prev Callback to call when prev button is clicked. If undefined, the button is disabled.
 */

interface NavButtonsProps {
  prev?: () => void;
  next?: () => void;
}

export function NavButtons({ prev, next }: NavButtonsProps) {
  return (
    <div className='flex w-full flex-row items-center justify-center gap-1'>
      <Button
        className='flex h-full w-full flex-row items-center justify-center'
        variant='primary'
        onClick={prev}
        disabled={!prev}
        style={{ maxWidth: '200px' }}
      >
        <ChevronLeft />
        <span className='hidden sm:block'>Previous Location</span>
      </Button>
      <Button
        className='flex h-full w-full flex-row items-center justify-center'
        variant='primary'
        onClick={next}
        disabled={!next}
        style={{ maxWidth: '200px' }}
      >
        <span className='hidden sm:block'>Next Location</span>
        <ChevronRight />
      </Button>
    </div>
  );
}
