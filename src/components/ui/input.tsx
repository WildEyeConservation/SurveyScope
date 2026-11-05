import { cn } from '@/lib/utils';
import * as React from 'react';
import { fieldBase, fieldSizes, type FieldSize } from './field';

const fileSizes = {
  sm: 'file:-my-1 file:-ml-2 file:mr-2 file:px-2 file:py-1',
  default: 'file:-my-1.5 file:-ml-3 file:mr-3 file:px-3 file:py-1.5',
  lg: 'file:-my-2 file:-ml-4 file:mr-4 file:px-4 file:py-2',
};

const Input = React.forwardRef(function Input(
  {
    className,
    type,
    size = 'default',
    htmlSize,
    ...props
  }: Omit<React.ComponentProps<'input'>, 'size'> & {
    size?: FieldSize;
    htmlSize?: number;
  },
  ref: React.ForwardedRef<React.ComponentRef<'input'>>,
) {
  return (
    <input
      type={type}
      size={htmlSize}
      data-slot='input'
      className={cn(
        fieldBase,
        fieldSizes[size],
        type === 'file' &&
          'file:border-0 file:border-r file:border-inherit file:bg-[#e9ecef] file:text-field-foreground hover:file:bg-[#dde0e3]',
        type === 'file' && fileSizes[size],
        type === 'color' && 'h-[38px] w-12 p-1.5',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export { Input };
