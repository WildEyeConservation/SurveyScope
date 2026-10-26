import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import { Modal } from 'react-bootstrap';
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
        setTimeout(
          () =>
            alert(
              `If ${email} has a SurveyScope account, they've been sent an invite.`
            ),
          300
        );
      }
    } catch (err: any) {
      alert(err.message ?? 'Failed to send invite');
    }

    setIsSubmitting(false);
  };

  return (
    <Modal show={show} onHide={() => showModal(null)}>
      <Modal.Header closeButton>
        <Modal.Title>Invite a user to {organization.name}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form onSubmit={handleSubmit}>
          <Form.Group className='mb-3' controlId='formBasicEmail'>
            <Form.Label>Email</Form.Label>
            <Form.Control
              type='email'
              placeholder='Enter email'
              name='email'
            />
          </Form.Group>
          <Button variant='primary' type='submit' disabled={isSubmitting}>
            Send Invite
          </Button>
          <Form.Text className='d-block mt-3'>
            The user will get the invite by email and in their SurveyScope
            inbox.
          </Form.Text>
          <Form.Text className='d-block'>
            Only people with a SurveyScope account receive invites. If the user
            doesn't have one, please contact WildEye support with the email of
            the user that requires an account.
          </Form.Text>
        </Form>
      </Modal.Body>
    </Modal>
  );
}
