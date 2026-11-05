import { fieldBase, fieldSizes, type FieldSize } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import * as React from 'react';

const Textarea = React.forwardRef(function Textarea(
  {
    className,
    size = 'default',
    ...props
  }: React.ComponentProps<'textarea'> & { size?: FieldSize },
  ref: React.ForwardedRef<React.ComponentRef<'textarea'>>,
) {
  return (
    <textarea
      data-slot='textarea'
      className={cn(
        fieldBase,
        fieldSizes[size],
        'min-h-[calc(1.5em+0.75rem+2px)]',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export { Textarea };
