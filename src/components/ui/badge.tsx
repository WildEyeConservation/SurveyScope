import { cn } from '@/lib/utils';
import { type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';
import { badgeVariants } from './badge-variants';

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

const Badge = React.forwardRef(function Badge(
  {
    className,
    variant = 'primary',
    pill = false,
    asChild = false,
    ...props
  }: React.ComponentProps<'span'> &
    VariantProps<typeof badgeVariants> & { asChild?: boolean; pill?: boolean },
  ref: React.ForwardedRef<React.ComponentRef<'span'>>,
) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot='badge'
      data-variant={variant}
      className={cn(
        badgeVariants({ variant }),
        pill && 'rounded-full',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export { Badge, type BadgeVariant };
