import { cn } from '@/lib/utils';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import * as React from 'react';

const Checkbox = React.forwardRef(function Checkbox(
  { className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>,
  ref: React.ForwardedRef<React.ComponentRef<typeof CheckboxPrimitive.Root>>,
) {
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      className={cn(
        'peer inline-flex size-4 shrink-0 items-center justify-center border border-black/25 bg-white align-middle text-white outline-none focus-visible:border-[#efb48c] focus-visible:ring-[0.25rem] focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        className,
      )}
      ref={ref}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot='checkbox-indicator'
        className='grid place-content-center text-current'
      >
        {props.checked === 'indeterminate' ? (
          <MinusIcon className='size-3.5' strokeWidth={3} />
        ) : (
          <CheckIcon className='size-3.5' strokeWidth={3} />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export { Checkbox };
