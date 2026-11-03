import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useContext, useState } from 'react';
import { GlobalContext } from '../Context';
import { graphqlErrorMessage } from '../reportClientErrorCore';

export default function InviteUserModal({
  organization,
  show,
}: {
  organization: {
    id: string;
    name: string;
  };
  show: boolean;
}) {
  const { client, showModal } = useContext(GlobalContext)!;
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    tone: 'success' | 'danger';
    text: string;
  } | null>(null);

  const close = () => {
    setEmail('');
    setResult(null);
    showModal(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const { errors } = await client.mutations.inviteUserToOrganization({
        organizationId: organization.id,
        email: address,
      });
      if (errors?.length) {
        setResult({ tone: 'danger', text: errors[0].message });
      } else {
        setEmail('');
        setResult({
          tone: 'success',
          text: `If ${address} has a SurveyScope account, they've been invited.`,
        });
      }
    } catch (err) {
      setResult({
        tone: 'danger',
        text: graphqlErrorMessage(err) || 'Failed to send invite',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={show} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader closeButton>
          <DialogTitle>Invite to {organization.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className='flex flex-col gap-2'>
            <Input
              id='invite-email'
              aria-label='Email'
              type='email'
              autoFocus
              placeholder='name@example.com'
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <span className='text-xs text-muted-foreground'>
              The owner of this email needs a SurveyScope account and should
              contact WildEye support if they don&apos;t have one.
            </span>
            {result && (
              <span
                className={cn(
                  'mt-2 text-sm',
                  result.tone === 'danger' ? 'text-danger' : 'text-success',
                )}
              >
                {result.text}
              </span>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              className='mr-auto'
              onClick={close}
            >
              Close
            </Button>
            <Button
              variant='primary'
              type='submit'
              disabled={isSubmitting || !email.trim()}
            >
              {isSubmitting ? 'Sending...' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
