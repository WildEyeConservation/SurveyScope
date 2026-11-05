import { cn } from '@/lib/utils';
import { Label as LabelPrimitive } from 'radix-ui';
import * as React from 'react';

const Label = React.forwardRef(function Label(
  { className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>,
  ref: React.ForwardedRef<React.ComponentRef<typeof LabelPrimitive.Root>>,
) {
  return (
    <LabelPrimitive.Root
      data-slot='label'
      className={cn(
        'mb-2 inline-block group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const FormText = React.forwardRef(function FormText(
  { className, ...props }: React.ComponentProps<'small'>,
  ref: React.ForwardedRef<React.ComponentRef<'small'>>,
) {
  return (
    <small
      data-slot='form-text'
      className={cn(
        'mt-1 block text-[0.875em] text-muted-foreground',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export { FormText, Label };
