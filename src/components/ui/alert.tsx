import { cn } from '@/lib/utils';
import { type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { alertVariants } from './alert-variants';

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>['variant']>;

const Alert = React.forwardRef(function Alert(
  {
    className,
    variant,
    onClose,
    children,
    ...props
  }: React.ComponentProps<'div'> &
    VariantProps<typeof alertVariants> & { onClose?: () => void },
  ref: React.ForwardedRef<React.ComponentRef<'div'>>,
) {
  return (
    <div
      data-slot='alert'
      role='alert'
      className={cn(alertVariants({ variant }), onClose && 'pr-12', className)}
      ref={ref}
      {...props}
    >
      {children}
      {onClose && (
        <button
          type='button'
          aria-label='Close'
          onClick={onClose}
          className='absolute top-0 right-0 p-4 text-current opacity-50 hover:opacity-75'
        >
          <XIcon className='size-4' />
        </button>
      )}
    </div>
  );
});

const AlertTitle = React.forwardRef(function AlertTitle(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<React.ComponentRef<'div'>>,
) {
  return (
    <div
      data-slot='alert-title'
      className={cn(
        'col-start-2 mb-2 text-2xl leading-tight font-medium',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const AlertDescription = React.forwardRef(function AlertDescription(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<React.ComponentRef<'div'>>,
) {
  return (
    <div
      data-slot='alert-description'
      className={cn('col-start-2', className)}
      ref={ref}
      {...props}
    />
  );
});

export { Alert, AlertDescription, AlertTitle, type AlertVariant };
