import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 border text-center align-middle leading-normal font-normal whitespace-nowrap no-underline transition-colors outline-none select-none focus-visible:ring-[0.25rem] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-65 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-white hover:bg-[#be5915] active:bg-primary-hover',
        primary:
          'border-transparent bg-primary text-white hover:bg-[#be5915] active:bg-primary-hover',
        secondary:
          'border-transparent bg-secondary text-white hover:bg-[#424f5c] active:bg-[#3e4a56]',
        success:
          'border-transparent bg-success text-white hover:bg-[#4e9c4e] active:bg-[#4a934a]',
        info: 'border-transparent bg-info text-white hover:bg-[#4da3bd] active:bg-[#499ab2]',
        warning:
          'border-transparent bg-warning text-[#212529] hover:bg-[#d9a406] active:bg-[#cc9a06]',
        danger:
          'border-transparent bg-danger text-white hover:bg-[#b84743] active:bg-[#ae423f]',
        destructive:
          'border-transparent bg-danger text-white hover:bg-[#b84743] active:bg-[#ae423f]',
        dark: 'border-transparent bg-dark text-white hover:bg-[#415567] active:bg-[#4d5f70]',
        light:
          'border-transparent bg-light text-white hover:bg-[#919ba5] active:bg-[#89929b]',
        'outline-primary':
          'border-primary bg-transparent text-primary hover:bg-primary hover:text-white',
        'outline-secondary':
          'border-secondary bg-transparent text-secondary hover:bg-secondary hover:text-white',
        'outline-success':
          'border-success bg-transparent text-success hover:bg-success hover:text-white',
        'outline-info':
          'border-info bg-transparent text-info hover:bg-info hover:text-white',
        'outline-warning':
          'border-warning bg-transparent text-warning hover:bg-warning hover:text-[#212529]',
        'outline-danger':
          'border-danger bg-transparent text-danger hover:bg-danger hover:text-white',
        'outline-light':
          'border-light bg-transparent text-light hover:bg-light hover:text-white',
        'outline-dark':
          'border-dark bg-transparent text-dark hover:bg-dark hover:text-white',
        outline: 'border-border bg-transparent text-foreground hover:bg-accent',
        ghost:
          'border-transparent bg-transparent text-foreground hover:bg-accent',
        link: 'border-transparent bg-transparent text-primary underline hover:text-primary-hover disabled:text-secondary',
      },
      size: {
        default: 'px-3 py-1.5 text-base',
        xs: 'gap-1 px-1.5 py-0.5 text-xs',
        sm: 'gap-1.5 px-2 py-1 text-sm',
        lg: 'px-4 py-2 text-xl',
        icon: 'size-[38px] p-0',
        'icon-xs': "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-[31px] p-0',
        'icon-lg': 'size-12 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

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
  ref: React.ForwardedRef<any>,
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

export { Button, buttonVariants, type ButtonVariant };
