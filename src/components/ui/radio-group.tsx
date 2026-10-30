import { cn } from '@/lib/utils';
import { CircleIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import * as React from 'react';

const RadioGroup = React.forwardRef(function RadioGroup(
  {
    className,
    ...props
  }: React.ComponentProps<typeof RadioGroupPrimitive.Root>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <RadioGroupPrimitive.Root
      data-slot='radio-group'
      className={cn('grid gap-3', className)}
      ref={ref}
      {...props}
    />
  );
});

const RadioGroupItem = React.forwardRef(function RadioGroupItem(
  {
    className,
    ...props
  }: React.ComponentProps<typeof RadioGroupPrimitive.Item>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <RadioGroupPrimitive.Item
      data-slot='radio-group-item'
      className={cn(
        'aspect-square size-4 shrink-0 rounded-full border border-black/25 bg-white outline-none focus-visible:border-[#efb48c] focus-visible:ring-[0.25rem] focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      ref={ref}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot='radio-group-indicator'
        className='relative flex items-center justify-center'
      >
        <CircleIcon className='absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 fill-white text-white' />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});

export { RadioGroup, RadioGroupItem };
