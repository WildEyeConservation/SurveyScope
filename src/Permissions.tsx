import { Card, CardContent } from '@/components/ui/card';
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

  if (!isOrganizationAdmin) {
    return <div>You are not authorized to access this page.</div>;
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '1555px',
        marginTop: '16px',
        paddingBottom: '16px',
        alignSelf: 'flex-start',
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
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PermissionsBody({
  organization,
}: {
  organization: { id: string; name: string };
}) {
  return (
    <Tabs defaultTab={0}>
      <Tab label='Users'>
        <Users key={organization.id} organization={organization} />
      </Tab>
      <Tab label='Organisation Info'>
        <Info organizationId={organization.id} />
      </Tab>
    </Tabs>
  );
}
