import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContext, useState } from 'react';
import { GlobalContext, TestingContext } from '../Context';
import OrganizationSelector from '../OrganizationSelector';
import { Tab, Tabs } from '../Tabs';
import { Schema } from '../amplify/client-schema';
import { useOptimisticUpdates } from '../useOptimisticUpdates';
import Results from './Results';
import Surveys from './Surveys';
import Users from './Users';

export default function Testing() {
  const { client } = useContext(GlobalContext)!;

  const [organization, setOrganization] = useState<{
    id: string;
    name: string;
  }>({ id: '', name: '' });

  const { data: projects } = useOptimisticUpdates<
    Schema['Project']['type'],
    'Project'
  >(
    'Project',
    async (nextToken) =>
      client.models.Project.list({
        nextToken,
        filter: { organizationId: { eq: organization.id } },
      }),
    {
      filter: { organizationId: { eq: organization.id } },
    },
  );

  const { data: testPresets } = useOptimisticUpdates<
    Schema['TestPreset']['type'],
    'TestPreset'
  >(
    'TestPreset',
    async (nextToken) =>
      client.models.TestPreset.list({
        nextToken,
        filter: { organizationId: { eq: organization.id } },
      }),
    {
      filter: { organizationId: { eq: organization.id } },
    },
    { staleTime: 5 * 60 * 1000 },
  );

  const membershipsHook = useOptimisticUpdates<
    Schema['OrganizationMembership']['type'],
    'OrganizationMembership'
  >(
    'OrganizationMembership',
    async (nextToken) =>
      client.models.OrganizationMembership.list({
        nextToken,
        filter: { organizationId: { eq: organization.id } },
      }),
    {
      filter: { organizationId: { eq: organization.id } },
    },
    {
      compositeKey: (membership) =>
        `${membership.organizationId}:${membership.userId}`,
    },
  );
  return (
    <TestingContext.Provider
      value={{
        organizationId: organization.id,
        organizationProjects: projects,
        organizationTestPresets: testPresets,
        organizationMembershipsHook: membershipsHook,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '1555px',
          marginTop: '16px',
          marginBottom: '16px',
        }}
      >
        <Card>
          <CardHeader className='mb-0 flex justify-between'>
            <CardTitle className='mb-0'>
              <h4 className='mb-0'>User Testing</h4>
            </CardTitle>
            <OrganizationSelector
              organization={organization}
              setOrganization={setOrganization}
            />
          </CardHeader>
          <CardContent>
            {organization.id && (
              <Tabs defaultTab={0}>
                <Tab label='Surveys'>
                  <Surveys />
                </Tab>
                <Tab label='Users'>
                  <Users />
                </Tab>
                <Tab label='Results'>
                  <Results />
                </Tab>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </TestingContext.Provider>
  );
}
