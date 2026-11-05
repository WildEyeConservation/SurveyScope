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
  /** Where the user is trying to go. Used to label the buttons. */
  destination: 'prev' | 'next' | 'jump';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown when the user manually tries to leave a pair that has unsaved
 * (un-accepted) work. Their per-pair drags and locks ARE preserved across
 * pairs (see usePairWorkingState), but we still ask for confirmation so a
 * stray Ctrl+→ doesn't yank them away mid-task.
 */
export function NavigateAwayDialog({
  show,
  destination,
  onConfirm,
  onCancel,
}: Props) {
  const verb =
    destination === 'prev'
      ? 'previous image pair'
      : destination === 'next'
        ? 'next image pair'
        : 'another image pair';
  return (
    <Dialog open={show} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent centered>
        <DialogHeader closeButton>
          <DialogTitle>Leave this image pair?</DialogTitle>
        </DialogHeader>
        <DialogBody>
          You have un-accepted matches on this image pair. Your marker positions
          will be remembered, but no links will be saved. Continue to the {verb}
          ?
        </DialogBody>
        <DialogFooter>
          <Button variant='secondary' onClick={onCancel}>
            Stay
          </Button>
          <Button variant='warning' onClick={onConfirm}>
            Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
