import { cn } from '@/lib/utils';
import { Popover as PopoverPrimitive } from 'radix-ui';
import * as React from 'react';

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot='popover' {...props} />;
}

const PopoverTrigger = React.forwardRef(function PopoverTrigger(
  { ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>,
  ref: React.ForwardedRef<React.ComponentRef<typeof PopoverPrimitive.Trigger>>,
) {
  return (
    <PopoverPrimitive.Trigger
      data-slot='popover-trigger'
      ref={ref}
      {...props}
    />
  );
});

const PopoverContent = React.forwardRef(function PopoverContent(
  {
    className,
    align = 'center',
    sideOffset = 4,
    ...props
  }: React.ComponentProps<typeof PopoverPrimitive.Content>,
  ref: React.ForwardedRef<React.ComponentRef<typeof PopoverPrimitive.Content>>,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot='popover-content'
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-[2147483100] w-72 origin-(--radix-popover-content-transform-origin) border border-border-subtle bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          className,
        )}
        ref={ref}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

const PopoverAnchor = React.forwardRef(function PopoverAnchor(
  { ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>,
  ref: React.ForwardedRef<React.ComponentRef<typeof PopoverPrimitive.Anchor>>,
) {
  return (
    <PopoverPrimitive.Anchor data-slot='popover-anchor' ref={ref} {...props} />
  );
});

const PopoverHeader = React.forwardRef(function PopoverHeader(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<React.ComponentRef<'div'>>,
) {
  return (
    <div
      data-slot='popover-header'
      className={cn('flex flex-col gap-1 text-sm', className)}
      ref={ref}
      {...props}
    />
  );
});

const PopoverTitle = React.forwardRef(function PopoverTitle(
  { className, ...props }: React.ComponentProps<'h2'>,
  ref: React.ForwardedRef<React.ComponentRef<'h2'>>,
) {
  return (
    <div
      data-slot='popover-title'
      className={cn('font-medium', className)}
      ref={ref}
      {...props}
    />
  );
});

const PopoverDescription = React.forwardRef(function PopoverDescription(
  { className, ...props }: React.ComponentProps<'p'>,
  ref: React.ForwardedRef<React.ComponentRef<'p'>>,
) {
  return (
    <p
      data-slot='popover-description'
      className={cn('text-muted-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
