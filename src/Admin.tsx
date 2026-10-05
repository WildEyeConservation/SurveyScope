import { useContext } from 'react';
import { UserContext } from './Context';
import { Tabs, Tab } from './Tabs';
import { Card } from 'react-bootstrap';
import PendingOrganizations from './PendingOrganizations';
import ClientLogs from './ClientLogs';
import ErrorReports from './ErrorReports';
import AdminStats from './AdminStats';
import AwsServiceHealth from './AwsServiceHealth';
import AdminSurveys from './AdminSurveys';

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
        <Card.Header>
          <Card.Title className='mb-0'>
            <h4 className='mb-0'>Admin</h4>
          </Card.Title>
        </Card.Header>
        <Card.Body>
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
            <Tab label='AWS Health'>
              <div className='m-2'>
                <AwsServiceHealth />
              </div>
            </Tab>
          </Tabs>
        </Card.Body>
      </Card>
    </div>
  );
}
