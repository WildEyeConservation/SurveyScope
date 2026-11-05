import { cn } from '@/lib/utils';
import { Tabs as TabsPrimitive } from 'radix-ui';
import * as React from 'react';

const Tabs = React.forwardRef(function Tabs(
  {
    className,
    orientation = 'horizontal',
    ...props
  }: React.ComponentProps<typeof TabsPrimitive.Root>,
  ref: React.ForwardedRef<React.ComponentRef<typeof TabsPrimitive.Root>>,
) {
  return (
    <TabsPrimitive.Root
      data-slot='tabs'
      data-orientation={orientation}
      orientation={orientation}
      className={cn('flex data-[orientation=horizontal]:flex-col', className)}
      ref={ref}
      {...props}
    />
  );
});

const TabsList = React.forwardRef(function TabsList(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>,
  ref: React.ForwardedRef<React.ComponentRef<typeof TabsPrimitive.List>>,
) {
  return (
    <TabsPrimitive.List
      data-slot='tabs-list'
      className={cn('flex flex-wrap border-b border-secondary', className)}
      ref={ref}
      {...props}
    />
  );
});

const TabsTrigger = React.forwardRef(function TabsTrigger(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>,
  ref: React.ForwardedRef<React.ComponentRef<typeof TabsPrimitive.Trigger>>,
) {
  return (
    <TabsPrimitive.Trigger
      data-slot='tabs-trigger'
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border border-transparent px-4 py-2 text-foreground transition-colors outline-none hover:border-secondary focus-visible:ring-[0.25rem] focus-visible:ring-primary/25 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-secondary data-[state=active]:border-b-transparent data-[state=active]:bg-[#0f2537] [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const TabsContent = React.forwardRef(function TabsContent(
  { className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>,
  ref: React.ForwardedRef<React.ComponentRef<typeof TabsPrimitive.Content>>,
) {
  return (
    <TabsPrimitive.Content
      data-slot='tabs-content'
      className={cn('flex-1 outline-none', className)}
      ref={ref}
      {...props}
    />
  );
});

export { Tabs, TabsContent, TabsList, TabsTrigger };
