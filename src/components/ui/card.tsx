import { cn } from '@/lib/utils';
import * as React from 'react';

const Card = React.forwardRef(function Card(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card'
      className={cn(
        'relative flex min-w-0 flex-col border border-border-subtle bg-card break-words text-card-foreground',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef(function CardHeader(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card-header'
      className={cn(
        'mb-0 border-b border-border-subtle bg-white/[0.075] px-4 py-2',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const CardTitle = React.forwardRef(function CardTitle(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card-title'
      className={cn('mb-2 text-xl leading-tight font-medium', className)}
      ref={ref}
      {...props}
    />
  );
});

const CardDescription = React.forwardRef(function CardDescription(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card-description'
      className={cn('text-muted-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

const CardAction = React.forwardRef(function CardAction(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card-action'
      className={cn('ml-auto self-start', className)}
      ref={ref}
      {...props}
    />
  );
});

const CardContent = React.forwardRef(function CardContent(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card-content'
      className={cn('flex-auto p-4', className)}
      ref={ref}
      {...props}
    />
  );
});

const CardFooter = React.forwardRef(function CardFooter(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='card-footer'
      className={cn(
        'border-t border-border-subtle bg-white/[0.075] px-4 py-2',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
