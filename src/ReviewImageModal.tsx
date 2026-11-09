import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

// Kept mounted so staged viewers load at the modal's actual size.
export default function ReviewImageModal({
  show,
  onClose,
  stageRef,
  children,
}: {
  show: boolean;
  onClose: () => void;
  stageRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const previous = document.activeElement as HTMLElement | null;
    // Dialogs opened later on top are new body children, so stay usable.
    const background = [...document.body.children].filter(
      (el) => el !== overlayRef.current && !el.hasAttribute('inert'),
    );
    for (const el of background) el.setAttribute('inert', '');
    panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      // A nested dialog that handled Escape has already prevented it.
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      for (const el of background) el.removeAttribute('inert');
      previous?.focus?.();
    };
  }, [show, onClose]);

  // inert must be omitted, not false; React 18 has no typing for it.
  const hiddenProps = (
    show ? {} : { inert: '', 'aria-hidden': true }
  ) as HTMLAttributes<HTMLDivElement>;

  return createPortal(
    <div
      ref={overlayRef}
      className='fixed inset-0 z-[2147483000] overflow-y-auto bg-black/50'
      style={{
        visibility: show ? undefined : 'hidden',
        pointerEvents: show ? undefined : 'none',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      {...hiddenProps}
    >
      <div className='pointer-events-none mx-2 my-2 flex sm:mx-auto sm:my-7 sm:max-w-[500px] lg:max-w-[800px] xl:max-w-[1140px]'>
        <div
          ref={panelRef}
          role='dialog'
          aria-modal='true'
          aria-labelledby={titleId}
          tabIndex={-1}
          className='pointer-events-auto relative flex w-full flex-col border border-border-subtle bg-card text-card-foreground shadow-lg outline-none'
        >
          <div className='flex shrink-0 items-center justify-between gap-2 border-b border-black/20 p-4'>
            <h2
              id={titleId}
              className='mb-0 text-[calc(1.275rem+0.3vw)] leading-normal font-medium xl:text-2xl'
            >
              View Image
            </h2>
            <button
              type='button'
              aria-label='Close'
              onClick={onClose}
              className='-my-2 -mr-2 ml-auto p-2 text-white opacity-50 hover:opacity-75'
            >
              <XIcon className='size-4' />
            </button>
          </div>
          <div
            ref={stageRef}
            className='relative flex-auto overflow-hidden'
            style={{ height: '75vh' }}
          >
            {children}
          </div>
          <div className='flex shrink-0 flex-wrap items-center justify-start gap-2 border-t border-black/20 p-4'>
            <Button variant='ghost' onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
