import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormText, Label } from '@/components/ui/label';
import { useContext, useState } from 'react';
import { GlobalContext } from '../Context';

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
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.target as HTMLFormElement);
    const email = formData.get('email') as string;

    if (!email) {
      alert('Please enter an email');
      return;
    }

    setIsSubmitting(true);

    try {
      const { errors } = await client.mutations.inviteUserToOrganization({
        organizationId: organization.id,
        email,
      });

      if (errors?.length) {
        alert(errors[0].message);
      } else {
        showModal(null);
        setTimeout(() => alert('Invite sent!'), 300);
      }
    } catch (err: any) {
      alert(err.message ?? 'Failed to send invite');
    }

    setIsSubmitting(false);
  };

  return (
    <Dialog open={show} onOpenChange={(o) => !o && showModal(null)}>
      <DialogContent>
        <DialogHeader closeButton>
          <DialogTitle>Invite a user to {organization.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit}>
            <div className='mb-4'>
              <Label htmlFor='formBasicEmail'>Email</Label>
              <Input
                id='formBasicEmail'
                type='email'
                placeholder='Enter email'
                name='email'
              />
            </div>
            <Button variant='primary' type='submit' disabled={isSubmitting}>
              Send Invite
            </Button>
            <FormText className='block mt-4'>
              This will send an invite to the user's SurveyScope inbox.
            </FormText>
            <FormText className='block'>
              If the user doesn't have an account, please contact WildEye support
              with the email of the user that requires an account.
            </FormText>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
