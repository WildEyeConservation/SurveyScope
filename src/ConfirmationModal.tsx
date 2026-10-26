import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConfirmationModalProps {
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: JSX.Element | string;
}

export default function ConfirmationModal({
  show,
  onClose,
  onConfirm,
  title,
  body,
}: ConfirmationModalProps) {
  return (
    <Dialog open={show} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{body}</DialogBody>
        <DialogFooter>
          <Button
            variant='primary'
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Confirm
          </Button>
          <Button variant='dark' onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
