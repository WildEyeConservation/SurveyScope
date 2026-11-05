import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Body, Header, Modal, Title } from '../Modal';
import { Schema } from '../amplify/client-schema';

export default function CreateOrganization({
  show,
  onHide,
  request,
}: {
  show: boolean;
  onHide: () => void;
  request?: Schema['OrganizationRegistration']['type'] & {
    requestedByEmail: string;
  };
}) {
  const { client } = useContext(GlobalContext);

  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!name) {
      alert('Name is required');
      return;
    }

    if (!adminEmail) {
      alert('Admin email is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const { errors } = await client.mutations.createOrganizationMutation({
        name,
        description,
        adminEmail,
        registrationId: request?.id,
      });

      if (errors?.length) {
        alert(errors[0].message);
      } else {
        alert('Organisation ' + name + ' created for ' + adminEmail);
      }
    } catch (err: any) {
      alert(err.message ?? 'Failed to create organization');
    }

    setIsSubmitting(false);
    handleClear();
    onHide();
  };

  async function handleDeny() {
    if (request) {
      await client.models.OrganizationRegistration.update({
        id: request.id,
        status: 'denied',
      });
    }

    onHide();
  }

  const handleClear = () => {
    setName('');
    setDescription('');
    setAdminEmail('');
  };

  useEffect(() => {
    if (request) {
      setName(request.organizationName);
      setDescription(request.briefDescription);
      setAdminEmail(request.requestedByEmail);
    }
    return () => {
      handleClear();
    };
  }, [request]);

  return (
    <Modal show={show} strict={true} size='lg'>
      <Header>
        <Title>{request ? 'Add' : 'Create'} Organisation</Title>
      </Header>
      <Body>
        <form onSubmit={handleSubmit} className='p-4'>
          <div className='mb-4'>
            <Label>Name</Label>
            <Input
              type='text'
              placeholder='Enter organisation name'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className='mb-4'>
            <Label>Description</Label>
            <Textarea
              rows={3}
              placeholder='Enter organisation description'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className='mb-4'>
            <Label>Admin Email</Label>
            <Input
              type='email'
              placeholder='Enter admin email'
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </div>
          <div className='flex gap-2'>
            <Button
              variant='ghost'
              type='button'
              className='mr-auto'
              onClick={onHide}
            >
              Cancel
            </Button>
            {request && (
              <Button variant='danger' onClick={handleDeny}>
                Deny
              </Button>
            )}
            <Button variant='primary' type='submit' disabled={isSubmitting}>
              {request ? 'Approve' : 'Create'}
            </Button>
          </div>
        </form>
      </Body>
    </Modal>
  );
}
