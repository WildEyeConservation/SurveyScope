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
  onConfirm: () => void;
}

/**
 * Final "you're done" dialog shown when every direct pair is complete AND
 * no actionable reunion candidates remain. Confirming closes the transect
 * on the server and returns the user to Jobs — without this gate the
 * harness silently navigated away, which read as "the app just kicked me
 * out".
 */
export function TransectCompleteDialog({ show, onConfirm }: Props) {
  return (
    <Dialog open={show}>
      <DialogContent centered static>
        <DialogHeader>
          <DialogTitle>Transect complete</DialogTitle>
        </DialogHeader>
        <DialogBody>
          Every image pair is finished and no reunions need review. Closing this
          dialog will finalise the transect and return you to Jobs.
        </DialogBody>
        <DialogFooter>
          <Button variant='primary' onClick={onConfirm}>
            Finish transect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
