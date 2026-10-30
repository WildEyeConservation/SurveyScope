import { cn } from '@/lib/utils';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

const Z_DIALOG = 'z-[2147483000]';

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot='dialog' {...props} />;
}

const DialogTrigger = React.forwardRef(function DialogTrigger(
  { ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <DialogPrimitive.Trigger data-slot='dialog-trigger' ref={ref} {...props} />
  );
});

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot='dialog-portal' {...props} />;
}

const DialogClose = React.forwardRef(function DialogClose(
  { ...props }: React.ComponentProps<typeof DialogPrimitive.Close>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <DialogPrimitive.Close data-slot='dialog-close' ref={ref} {...props} />
  );
});

const DialogOverlay = React.forwardRef(function DialogOverlay(
  { className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <DialogPrimitive.Overlay
      data-slot='dialog-overlay'
      className={cn(
        'fixed inset-0 overflow-y-auto bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        Z_DIALOG,
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const dialogSizes = {
  sm: 'sm:max-w-[300px]',
  md: 'sm:max-w-[500px]',
  lg: 'lg:max-w-[800px] sm:max-w-[500px]',
  xl: 'xl:max-w-[1140px] lg:max-w-[800px] sm:max-w-[500px]',
};

type DialogSize = keyof typeof dialogSizes;

const DialogContent = React.forwardRef(function DialogContent(
  {
    className,
    children,
    size = 'md',
    centered = false,
    fullscreen = false,
    scrollable = false,
    static: isStatic = false,
    staticBackdrop = false,
    keyboard = true,
    showCloseButton = false,
    onPointerDownOutside,
    onEscapeKeyDown,
    onInteractOutside,
    onOpenAutoFocus,
    ...props
  }: React.ComponentProps<typeof DialogPrimitive.Content> & {
    size?: DialogSize;
    centered?: boolean;
    fullscreen?: boolean;
    scrollable?: boolean;
    static?: boolean;
    staticBackdrop?: boolean;
    keyboard?: boolean;
    showCloseButton?: boolean;
  },
  ref: React.ForwardedRef<any>,
) {
  return (
    <DialogPortal data-slot='dialog-portal'>
      <DialogOverlay>
        <div
          className={cn(
            'pointer-events-none mx-2 my-2 flex sm:mx-auto sm:my-7',
            !fullscreen && dialogSizes[size],
            centered &&
              'min-h-[calc(100%-1rem)] items-center sm:min-h-[calc(100%-3.5rem)]',
            scrollable && 'h-[calc(100%-1rem)] sm:h-[calc(100%-3.5rem)]',
            fullscreen && 'm-0 h-full w-full max-w-none sm:m-0',
          )}
        >
          <DialogPrimitive.Content
            data-slot='dialog-content'
            aria-describedby={undefined}
            onPointerDownOutside={(e) => {
              const target = e.target as Element | null;
              if (
                isStatic ||
                staticBackdrop ||
                !target?.closest?.('[data-slot=dialog-overlay]')
              )
                e.preventDefault();
              onPointerDownOutside?.(e);
            }}
            onOpenAutoFocus={(e) => {
              onOpenAutoFocus?.(e);
              if (e.defaultPrevented) return;
              e.preventDefault();
              const content = e.currentTarget as HTMLElement;
              if (!content.contains(document.activeElement)) content.focus();
            }}
            onInteractOutside={(e) => {
              const target = e.target as Element | null;
              if (!target?.closest?.('[data-slot=dialog-overlay]'))
                e.preventDefault();
              onInteractOutside?.(e);
            }}
            onEscapeKeyDown={(e) => {
              if (isStatic || !keyboard) e.preventDefault();
              onEscapeKeyDown?.(e);
            }}
            className={cn(
              'pointer-events-auto relative flex w-full flex-col border border-border-subtle bg-card text-card-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-12',
              scrollable &&
                'max-h-full overflow-hidden [&>[data-slot=dialog-body]]:overflow-y-auto',
              fullscreen && 'h-full border-0',
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close
                data-slot='dialog-close'
                className="absolute top-4 right-4 opacity-50 hover:opacity-75 focus:outline-hidden [&_svg:not([class*='size-'])]:size-4"
              >
                <XIcon />
                <span className='sr-only'>Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </div>
      </DialogOverlay>
    </DialogPortal>
  );
});

const DialogHeader = React.forwardRef(function DialogHeader(
  {
    className,
    closeButton = false,
    children,
    ...props
  }: React.ComponentProps<'div'> & { closeButton?: boolean },
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='dialog-header'
      className={cn(
        'flex shrink-0 items-center justify-between gap-2 border-b border-black/20 p-4',
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
      {closeButton && (
        <DialogPrimitive.Close
          aria-label='Close'
          className='-my-2 -mr-2 ml-auto p-2 text-white opacity-50 hover:opacity-75'
        >
          <XIcon className='size-4' />
        </DialogPrimitive.Close>
      )}
    </div>
  );
});

const DialogBody = React.forwardRef(function DialogBody(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='dialog-body'
      className={cn('relative flex-auto p-4', className)}
      ref={ref}
      {...props}
    />
  );
});

const DialogFooter = React.forwardRef(function DialogFooter(
  { className, ...props }: React.ComponentProps<'div'>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <div
      data-slot='dialog-footer'
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-black/20 p-4',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const DialogTitle = React.forwardRef(function DialogTitle(
  { className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      className={cn(
        'mb-0 text-[calc(1.275rem+0.3vw)] leading-normal font-medium xl:text-2xl',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

const DialogDescription = React.forwardRef(function DialogDescription(
  {
    className,
    ...props
  }: React.ComponentProps<typeof DialogPrimitive.Description>,
  ref: React.ForwardedRef<any>,
) {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn('text-muted-foreground', className)}
      ref={ref}
      {...props}
    />
  );
});

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  type DialogSize,
};
