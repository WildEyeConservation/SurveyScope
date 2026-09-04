import { Button, Card, Form, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useContext, useState } from 'react';
import { UserContext } from './Context';
import { client } from './stores/appClient';
import { fetchAllPaginatedResults } from './utils';
import { useNavigate } from 'react-router-dom';

/*
    todo: Notify sysadmin
*/

export default function RegisterOrganization() {
  const { user, cognitoGroups } = useContext(UserContext)!;
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);

    const formData = new FormData(event.target as HTMLFormElement);
    const organizationName = formData.get('organizationName') as string;
    const briefDescription = formData.get('briefDescription') as string;

    const organizations = await fetchAllPaginatedResults(
      client.models.Organization.list,
      {
        selectionSet: ['id'],
        filter: {
          name: {
            eq: organizationName,
          },
        },
      }
    );

    if (organizations.length > 0) {
      alert('An organisation with this name already exists');
      return;
    }

    const registrations = await fetchAllPaginatedResults(
      client.models.OrganizationRegistration.list,
      {
        selectionSet: ['id'],
        filter: {
          requestedBy: {
            contains: user.userId,
          },
          status: {
            eq: 'pending',
          },
        },
      }
    );

    if (registrations.length > 0) {
      alert('You have already requested an organisation registration');
      setIsLoading(false);
      return;
    }

    const { data: organizationRegistration } =
      await client.models.OrganizationRegistration.create({
        organizationName,
        briefDescription,
        requestedBy: user.userId,
      });

    if (!organizationRegistration) {
      alert('An error occurred while submitting your request');
      setIsLoading(false);
      return;
    }

    alert('Your request has been submitted');

    if (cognitoGroups.includes('sysadmin')) {
      navigate('/SSAdmin');
    } else {
      navigate('/');
    }

    setIsLoading(false);
  }

  return (
    <Card
      className='w-100'
      style={{
        marginTop: '12px',
        marginBottom: '12px',
        height: 'fit-content',
        maxWidth: '960px',
      }}
    >
      <Card.Header>
        <Card.Title className='mb-0'>
          <h4 className='mb-0'>Register Organisation</h4>
        </Card.Title>
      </Card.Header>
      <Card.Body>
        <Form className='d-flex flex-column gap-3' onSubmit={handleSubmit}>
          <span className='text-muted'>
            Here you can register your organisation for SurveyScope - you will
            automatically be redirected after a successful manual review of your
            details.
          </span>
          <Form.Group>
            <Form.Label>Organisation Name</Form.Label>
            <Form.Control
              name='organizationName'
              type='text'
              placeholder='Enter organisation name'
              required
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Brief Description of Work</Form.Label>
            <Form.Control
              name='briefDescription'
              as='textarea'
              rows={3}
              placeholder='Enter brief description of work'
              required
            />
          </Form.Group>
          <OverlayTrigger
            placement='top'
            overlay={<Tooltip id='register-org-tooltip'>Under maintenance</Tooltip>}
          >
            <div className='d-inline-block'>
              <Button
                type='submit'
                variant='primary'
                disabled={true}
                style={{ pointerEvents: 'none' }}
              >
                {isLoading ? 'Submitting...' : 'Submit'}
              </Button>
            </div>
          </OverlayTrigger>
        </Form>
      </Card.Body>
    </Card>
  );
}
