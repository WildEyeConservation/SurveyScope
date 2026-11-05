'use client';

import { cn } from '@/lib/utils';
import { type VariantProps } from 'class-variance-authority';
import { Toggle as TogglePrimitive } from 'radix-ui';
import * as React from 'react';
import { toggleVariants } from './toggle-variants';

const Toggle = React.forwardRef(function Toggle(
  {
    className,
    variant,
    size,
    ...props
  }: React.ComponentProps<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>,
  ref: React.ForwardedRef<React.ComponentRef<typeof TogglePrimitive.Root>>,
) {
  return (
    <TogglePrimitive.Root
      data-slot='toggle'
      className={cn(toggleVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});

export { Toggle };
