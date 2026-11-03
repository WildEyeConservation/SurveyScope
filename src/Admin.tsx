import { Card, CardContent } from '@/components/ui/card';
import { useContext } from 'react';
import AdminStats from './AdminStats';
import AdminSurveys from './AdminSurveys';
import AwsServiceHealth from './AwsServiceHealth';
import ClientLogs from './ClientLogs';
import { UserContext } from './Context';
import ErrorReports from './ErrorReports';
import PageHeader from './PageHeader';
import PendingOrganizations from './PendingOrganizations';
import SurveyMetrics from './survey-metrics/SurveyMetrics';
import { Tab, Tabs } from './Tabs';

export default function Admin() {
  const { cognitoGroups } = useContext(UserContext)!;

  if (!cognitoGroups.includes('sysadmin')) {
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
        <PageHeader title='Admin' />
        <CardContent>
          <Tabs>
            <Tab label='Pending Organisations'>
              <div className='mx-2 mt-4 mb-2'>
                <PendingOrganizations />
              </div>
            </Tab>
            <Tab label='Client Logs'>
              <div className='mx-2 mt-4 mb-2'>
                <ClientLogs />
              </div>
            </Tab>
            <Tab label='Error Reports'>
              <div className='mx-2 mt-4 mb-2'>
                <ErrorReports />
              </div>
            </Tab>
            <Tab label='Statistics'>
              <div className='mx-2 mt-4 mb-2'>
                <AdminStats />
              </div>
            </Tab>
            <Tab label='Surveys'>
              <div className='mx-2 mt-4 mb-2'>
                <AdminSurveys />
              </div>
            </Tab>
            <Tab label='Survey Metrics'>
              <div className='mx-2 mt-4 mb-2'>
                <SurveyMetrics />
              </div>
            </Tab>
            <Tab label='AWS Health'>
              <div className='mx-2 mt-4 mb-2'>
                <AwsServiceHealth />
              </div>
            </Tab>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
