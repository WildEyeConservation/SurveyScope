import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className='rounded-sm border border-black/20 bg-black/5 px-1 font-mono text-[10px] leading-4 text-[#495057]'>
      {children}
    </kbd>
  );
}

export function MapButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
  className,
  tipSide = 'right',
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  tipSide?: 'right' | 'left' | 'top';
}) {
  return (
    <button
      type='button'
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group relative flex size-9 items-center justify-center text-[#212529] transition-colors disabled:cursor-not-allowed disabled:[&>svg]:opacity-35',
        active ? 'bg-primary text-white [&_svg]:!text-white' : 'enabled:hover:bg-black/10',
        className
      )}
    >
      {children}
      <span
        className={cn(
          'pointer-events-none absolute z-20 hidden items-center gap-1.5 whitespace-nowrap border border-black/10 bg-white px-2 py-1 text-xs text-[#212529] shadow-md group-hover:flex group-focus-visible:flex',
          tipSide === 'right' && 'left-full ml-2',
          tipSide === 'left' && 'right-full mr-2',
          tipSide === 'top' && 'bottom-full mb-2'
        )}
      >
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
    </button>
  );
}
