import { cn } from '@/lib/utils';
import { Switch as SwitchPrimitive } from 'radix-ui';
import * as React from 'react';

const Switch = React.forwardRef(function Switch(
  { className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>,
  ref: React.ForwardedRef<React.ComponentRef<typeof SwitchPrimitive.Root>>,
) {
  return (
    <SwitchPrimitive.Root
      data-slot='switch'
      className={cn(
        'peer group/switch inline-flex h-4 w-8 shrink-0 items-center rounded-full border border-black/25 bg-white px-[2px] align-middle transition-colors outline-none focus-visible:border-[#efb48c] focus-visible:ring-[0.25rem] focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      ref={ref}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot='switch-thumb'
        className='pointer-events-none block size-2.5 rounded-full bg-black/25 transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-white'
      />
    </SwitchPrimitive.Root>
  );
});

export { Switch };
