import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  show: boolean;
  /** Commit the link (immediate — writes the shared objectId). */
  onConfirm: () => void;
  /** Dismiss without linking. */
  onCancel: () => void;
}

/**
 * Shown when the user ctrl+clicks a real marker on the other image while a
 * candidate is active. Confirming asserts the two annotations are the same
 * individual: they get a shared identity and the Munkres shadow proposals on
 * both sides collapse on the next rebuild. This is the deliberate gate — the
 * link is written immediately on confirm.
 */
export function LinkAnnotationDialog({ show, onConfirm, onCancel }: Props) {
  return (
    <Dialog open={show} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent centered>
        <DialogHeader closeButton>
          <DialogTitle>Link these annotations?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          This will mark the clicked annotation and the currently active one as
          the same individual, sharing a single identity across both images. The
          proposed shadow markers for this animal will disappear. This is saved
          immediately.
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={onCancel}>
            Cancel
          </Button>
          <Button variant='primary' onClick={onConfirm}>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
