import React, { useState, ReactElement } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogSize,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function Header({
  closeButton = false,
  ...props
}: React.ComponentProps<'div'> & { closeButton?: boolean }) {
  return <DialogHeader closeButton={closeButton} {...props} />;
}

export function Title(props: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle {...props} />;
}

export function Body(props: React.ComponentProps<'div'>) {
  return <DialogBody {...props} />;
}

export function Footer(props: React.ComponentProps<'div'>) {
  return <DialogFooter {...props} />;
}

interface CustomModalProps {
  show?: boolean;
  onHide?: () => void;
  size?: DialogSize;
  centered?: boolean;
  fullscreen?: boolean;
  backdrop?: boolean | 'static';
  keyboard?: boolean;
  className?: string;
  dialogClassName?: string;
  contentClassName?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  /** When true, prevents backdrop/keyboard dismissal */
  strict?: boolean;
  /** Component to render in the help overlay */
  helpComponent?: React.ComponentType;
  /** Text for the help button (defaults to "Help") */
  helpButtonText?: string;
  /** When true, disables all form elements within the modal */
  disabled?: boolean;
}

function CustomModal({
  show = false,
  onHide,
  size = 'xl',
  centered,
  fullscreen,
  backdrop,
  keyboard,
  className,
  dialogClassName,
  contentClassName,
  style,
  strict = false,
  helpComponent: HelpComponent,
  helpButtonText = 'Help',
  disabled = false,
  children,
}: CustomModalProps) {
  const [showHelp, setShowHelp] = useState(false);

  let modalHeader: ReactElement<any> | null = null;
  let modalFooter: ReactElement | null = null;
  const modalBodyChildren: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === Header) {
      modalHeader = child;
    } else if (child.type === Footer) {
      modalFooter = child;
    } else if (child.type === Body) {
      React.Children.forEach(
        (child as ReactElement<any>).props.children,
        (bodyChild) => {
          if (React.isValidElement(bodyChild)) modalBodyChildren.push(bodyChild);
        }
      );
    } else {
      modalBodyChildren.push(child);
    }
  });

  const header = modalHeader as ReactElement<any> | null;
  const blockOutside = strict || backdrop === 'static';
  const blockEscape = strict || keyboard === false;

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onHide?.();
      }}
    >
      <DialogContent
        size={size}
        centered={centered}
        fullscreen={fullscreen}
        onPointerDownOutside={(e) => blockOutside && e.preventDefault()}
        onEscapeKeyDown={(e) => blockEscape && e.preventDefault()}
        className={cn(className, dialogClassName, contentClassName)}
        style={style}
      >
        <DialogHeader closeButton={!!header?.props.closeButton}>
          <div className='flex-1'>
            {header && (
              <div
                className={cn('flex items-center', header.props.className)}
                style={header.props.style}
              >
                {header.props.children}
              </div>
            )}
          </div>
          {HelpComponent && (
            <Button variant='info' onClick={() => setShowHelp(!showHelp)}>
              {showHelp ? 'Hide' : helpButtonText}
            </Button>
          )}
        </DialogHeader>

        <div className='relative'>
          <DialogBody className='relative p-0'>
            <fieldset
              disabled={disabled}
              className='m-0 flex h-full flex-col border-0 p-0'
            >
              {modalBodyChildren}
            </fieldset>
          </DialogBody>

          {modalFooter}

          {showHelp && HelpComponent && (
            <div className='absolute inset-0 z-10 flex flex-col bg-[#4E5D6C]'>
              <div className='flex items-center border-b border-[#dee2e6] p-4'>
                <Button
                  className='flex items-center gap-2 px-2 py-1 text-white'
                  onClick={() => setShowHelp(false)}
                >
                  <ArrowLeft size={16} />
                  <span>Back</span>
                </Button>
              </div>
              <div className='flex-1 overflow-auto p-4'>
                <HelpComponent />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { CustomModal as Modal };

export default CustomModal;
