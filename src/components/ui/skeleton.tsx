import { cn } from '@/lib/utils';
import * as React from 'react';

const Skeleton = React.forwardRef(function Skeleton(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='skeleton'
      className={cn('animate-pulse rounded-md bg-accent', className)}
      ref={ref}
      {...props}
    />
  );
});

export { Skeleton };
