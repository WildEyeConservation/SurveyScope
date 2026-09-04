import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import { useState, useEffect } from 'react';
import { client } from '../stores/appClient';
import { Modal, Body, Header, Title } from '../Modal';
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
        <Form onSubmit={handleSubmit} className='p-3'>
          <Form.Group className='mb-3'>
            <Form.Label>Name</Form.Label>
            <Form.Control
              type='text'
              placeholder='Enter organisation name'
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Form.Group>
          <Form.Group className='mb-3'>
            <Form.Label>Description</Form.Label>
            <Form.Control
              as='textarea'
              rows={3}
              placeholder='Enter organisation description'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Form.Group>
          <Form.Group className='mb-3'>
            <Form.Label>Admin Email</Form.Label>
            <Form.Control
              type='email'
              placeholder='Enter admin email'
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
            />
          </Form.Group>
          <div
            className={`d-flex gap-2 justify-content-${
              request ? 'between' : 'end'
            }`}
          >
            {request && (
              <Button variant='danger' onClick={handleDeny}>
                Deny
              </Button>
            )}
            <div>
              <Button
                variant='primary'
                className='me-2'
                type='submit'
                disabled={isSubmitting}
              >
                {request ? 'Approve' : 'Create'}
              </Button>
              <Button variant='dark' type='button' onClick={onHide}>
                Cancel
              </Button>
            </div>
          </div>
        </Form>
      </Body>
    </Modal>
  );
}
