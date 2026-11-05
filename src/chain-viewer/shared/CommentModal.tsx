import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormText, Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useState } from 'react';

interface Props {
  show: boolean;
  /** Existing comment text to prefill (empty string when none). */
  initial: string;
  onClose: () => void;
  onSave: (text: string) => void;
}

/**
 * Simple free-text comment editor for a single annotation. Records a reviewer
 * comment opinion (ChainReviewFeedback, kind `comment`) — never touches the
 * snapshot. Prefills any existing comment so the reviewer edits in place.
 */
export function CommentModal({ show, initial, onClose, onSave }: Props) {
  const [text, setText] = useState(initial);

  // Re-seed the field each time the modal opens for a (possibly different)
  // annotation.
  useEffect(() => {
    if (show) setText(initial);
  }, [show, initial]);

  const trimmed = text.trim();
  const unchanged = trimmed === initial.trim();

  return (
    <Dialog open={show} onOpenChange={(o) => !o && onClose()}>
      <DialogContent centered>
        <DialogHeader closeButton>
          <DialogTitle>Comment</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div>
            <Label htmlFor='comment-modal-text'>
              Your note on this annotation
            </Label>
            <Textarea
              id='comment-modal-text'
              rows={4}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              placeholder='Add a comment for this annotation…'
            />
            <FormText className='text-muted-foreground'>
              Recorded as your review feedback; it never changes the original
              data.
            </FormText>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant='primary'
            disabled={unchanged}
            onClick={() => onSave(trimmed)}
          >
            Save comment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
