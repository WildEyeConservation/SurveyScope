import { cn } from '@/lib/utils';
import { type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { buttonVariants } from './button-variants';

type ButtonVariant = NonNullable<
  VariantProps<typeof buttonVariants>['variant']
>;

const Button = React.forwardRef(function Button(
  {
    className,
    variant = 'primary',
    size = 'default',
    asChild = false,
    active = false,
    type,
    ...props
  }: React.ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & {
      asChild?: boolean;
      active?: boolean;
    },
  ref: React.ForwardedRef<React.ComponentRef<'button'>>,
) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot='button'
      data-variant={variant}
      data-size={size}
      data-active={active || undefined}
      type={asChild ? type : (type ?? 'button')}
      className={cn(
        buttonVariants({ variant, size }),
        active && 'brightness-90',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export { Button, type ButtonVariant };
