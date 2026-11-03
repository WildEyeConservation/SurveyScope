import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { useContext, useState } from 'react';
import { UserContext } from './Context';
import Info from './organization/Info';
import Users from './organization/Users';
import OrganizationSelector from './OrganizationSelector';
import PageHeader from './PageHeader';
import { Tab, Tabs } from './Tabs';

export default function Permissions() {
  const { isOrganizationAdmin } = useContext(UserContext)!;
  const [organization, setOrganization] = useState<{
    id: string;
    name: string;
  }>({ id: '', name: '' });
  const [onClick, setOnClick] = useState<{
    name: string;
    function: () => void;
  } | null>(null);

  if (!isOrganizationAdmin) {
    return <div>You are not authorized to access this page.</div>;
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        marginBottom: '16px',
      }}
    >
      <Card>
        <PageHeader title='Permissions'>
          <OrganizationSelector
            organization={organization}
            setOrganization={setOrganization}
          />
        </PageHeader>
        <CardContent>
          {organization.id && (
            <PermissionsBody
              key={organization.id}
              organization={organization}
              setOnClick={setOnClick}
            />
          )}
        </CardContent>
        {onClick && (
          <CardFooter className='flex justify-center'>
            <Button variant='primary' onClick={onClick.function}>
              {onClick.name}
            </Button>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}

function PermissionsBody({
  organization,
  setOnClick,
}: {
  organization: { id: string; name: string };
  setOnClick: (onClick: { name: string; function: () => void } | null) => void;
}) {
  return (
    <Tabs defaultTab={0} onTabChange={() => setOnClick(null)}>
      <Tab label='Users'>
        <Users
          key={organization.id}
          organization={organization}
          setOnClick={setOnClick}
        />
      </Tab>
      <Tab label='Organisation Info'>
        <Info organizationId={organization.id} />
      </Tab>
    </Tabs>
  );
}
