import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlobalContext, UserContext } from './Context';
import { fetchAllPaginatedResults } from './utils';

/*
    todo: Notify sysadmin
*/

export default function RegisterOrganization() {
  const { client } = useContext(GlobalContext)!;
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
      },
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
      },
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
      className='w-full'
      style={{
        marginTop: '12px',
        marginBottom: '12px',
        height: 'fit-content',
        maxWidth: '960px',
      }}
    >
      <CardHeader>
        <CardTitle className='mb-0'>
          <h4 className='mb-0'>Register Organisation</h4>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className='flex flex-col gap-4' onSubmit={handleSubmit}>
          <span className='text-muted-foreground'>
            Here you can register your organisation for SurveyScope - you will
            automatically be redirected after a successful manual review of your
            details.
          </span>
          <div>
            <Label>Organisation Name</Label>
            <Input
              name='organizationName'
              type='text'
              placeholder='Enter organisation name'
              required
            />
          </div>
          <div>
            <Label>Brief Description of Work</Label>
            <Textarea
              name='briefDescription'
              rows={3}
              placeholder='Enter brief description of work'
              required
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className='inline-block self-start' tabIndex={0}>
                <Button
                  type='submit'
                  variant='primary'
                  disabled={true}
                  style={{ pointerEvents: 'none' }}
                >
                  {isLoading ? 'Submitting...' : 'Submit'}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent side='top'>Under maintenance</TooltipContent>
          </Tooltip>
        </form>
      </CardContent>
    </Card>
  );
}
