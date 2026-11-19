import { cn } from '@/lib/utils';
import { Eye } from 'lucide-react';
import { notebook } from './store';
import type { LabelRef } from './types';

// Keeps the click away from the label button the icon sits inside.
const swallow = (event: React.SyntheticEvent) => {
  event.stopPropagation();
  event.preventDefault();
};

export function LabelPeek({
  label,
  tone = 'onColor',
  className,
}: {
  label: LabelRef;
  tone?: 'onColor' | 'onLight';
  className?: string;
}) {
  return (
    <span
      role='button'
      tabIndex={-1}
      aria-label={`Show examples of ${label.name}`}
      title={`Show examples of ${label.name}`}
      className={cn(
        'inline-flex size-7 flex-none cursor-pointer items-center justify-center',
        tone === 'onColor'
          ? 'text-white opacity-75 hover:bg-black/25 hover:opacity-100'
          : 'text-[#495057] hover:bg-black/10 hover:text-black',
        className,
      )}
      onPointerDown={swallow}
      onMouseDown={swallow}
      onClick={(e) => {
        swallow(e);
        notebook.openPalette(label);
      }}
    >
      <Eye className='size-4' />
    </span>
  );
}
