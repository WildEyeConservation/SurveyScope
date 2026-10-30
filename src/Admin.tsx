import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContext } from 'react';
import AdminStats from './AdminStats';
import AdminSurveys from './AdminSurveys';
import AwsServiceHealth from './AwsServiceHealth';
import ClientLogs from './ClientLogs';
import { UserContext } from './Context';
import ErrorReports from './ErrorReports';
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
        marginBottom: '16px',
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle className='mb-0'>
            <h4 className='mb-0'>Admin</h4>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs>
            <Tab label='Pending Organisations'>
              <PendingOrganizations />
            </Tab>
            <Tab label='Client Logs'>
              <div className='m-2'>
                <ClientLogs />
              </div>
            </Tab>
            <Tab label='Error Reports'>
              <div className='m-2'>
                <ErrorReports />
              </div>
            </Tab>
            <Tab label='Statistics'>
              <div className='m-2'>
                <AdminStats />
              </div>
            </Tab>
            <Tab label='Surveys'>
              <div className='m-2'>
                <AdminSurveys />
              </div>
            </Tab>
            <Tab label='Survey Metrics'>
              <div className='m-2'>
                <SurveyMetrics />
              </div>
            </Tab>
            <Tab label='AWS Health'>
              <div className='m-2'>
                <AwsServiceHealth />
              </div>
            </Tab>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
