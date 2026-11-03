import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';

export function GridTable({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='grid-table'
      className={cn('border border-dark bg-white/[0.07] text-sm', className)}
      {...props}
    />
  );
}

export function GridHead({
  className,
  sticky,
  ...props
}: ComponentProps<'div'> & { sticky?: boolean }) {
  return (
    <div
      className={cn(
        'border-b border-dark bg-table-head px-3 py-2 text-sm font-bold text-white',
        sticky && 'sticky top-0 z-10',
        className,
      )}
      {...props}
    />
  );
}

export function GridRow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot='grid-row'
      className={cn(
        'border-b border-white/[0.08] px-3 py-2 last:border-b-0',
        className,
      )}
      {...props}
    />
  );
}

export function GridMessage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-3 py-3 text-muted-foreground', className)}
      {...props}
    />
  );
}
