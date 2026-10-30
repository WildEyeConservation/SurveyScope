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
  splitCount: number;
  retainedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SplitChainDialog({
  show,
  splitCount,
  retainedCount,
  onConfirm,
  onCancel,
}: Props) {
  const newer = Math.max(0, splitCount - 1);
  return (
    <Dialog open={show} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent centered>
        <DialogHeader closeButton>
          <DialogTitle>Split chain from here?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          This will make the selected annotation the start of a new identity.
          The
          {newer > 0 ? (
            <>
              {' '}
              selected annotation and {newer} newer linked sighting
              {newer === 1 ? '' : 's'} will move into the new chain;{' '}
            </>
          ) : (
            <> selected annotation will move into the new chain; </>
          )}
          {retainedCount} older linked sighting
          {retainedCount === 1 ? '' : 's'} will stay in the original chain. This
          is saved immediately.
        </DialogBody>
        <DialogFooter>
          <Button variant='secondary' onClick={onCancel}>
            Cancel
          </Button>
          <Button variant='warning' onClick={onConfirm}>
            Split chain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
