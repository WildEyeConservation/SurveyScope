import MyTable from './Table';
import { useContext, useState } from 'react';
import { GlobalContext } from './Context';
import { useOptimisticUpdates } from './useOptimisticUpdates';
import type { Schema } from './amplify/client-schema';
import { useUsers } from './apiInterface';
import { Button } from '@/components/ui/button';
import CreateOrganization from './organization/CreateOrganization';

export default function PendingOrganizations() {
  const { client, showModal, modalToShow } = useContext(GlobalContext);
  const { users } = useUsers();

  const [selectedRequest, setSelectedRequest] = useState<
    (Schema['OrganizationRegistration']['type'] & { requestedByEmail: string }) | null
  >(null);

  const { data: requests } = useOptimisticUpdates<
    Schema['OrganizationRegistration']['type'],
    'OrganizationRegistration'
  >('OrganizationRegistration', async (nextToken) =>
    client.models.OrganizationRegistration.list({
      nextToken,
    })
  );

  const tableData = requests
    .filter((request) => request.status === 'pending')
    .map((request) => {
      const requestedBy = users.find((user) => user.id === request.requestedBy);

      return {
        id: request.id,
        rowData: [
          <div>{request.organizationName.slice(0, 50)}</div>,
          <div>{request.briefDescription.slice(0, 50)}</div>,
          <div>
            {requestedBy?.name} ({requestedBy?.email})
          </div>,
          <div>{new Date(request.createdAt ?? '').toLocaleDateString()}</div>,
          <Button
            variant='primary'
            onClick={() => {
              setSelectedRequest({
                ...request,
                requestedByEmail: requestedBy?.email || '',
              });
              showModal('createOrganization');
            }}
          >
            Review
          </Button>,
        ],
      };
    });

  const tableHeadings = [
    { content: 'Organisation Name', style: { width: '20%' }, sort: true },
    { content: 'Brief Description', style: { width: '20%' }, sort: true },
    { content: 'Requested By', style: { width: '20%' }, sort: true },
    { content: 'Date', style: { width: '20%' }, sort: true },
    { content: 'Review Request', style: { width: '20%' } },
  ];

  return (
    <div className='m-2'>
      <h5>Pending Organisations</h5>
      <MyTable
        tableData={tableData}
        tableHeadings={tableHeadings}
        pagination={true}
        itemsPerPage={10}
        emptyMessage='No pending organisations'
      />
      <div className='flex justify-center items-center border-t pt-4 border-dark mt-4'>
        <Button
          variant='primary'
          onClick={() => showModal('createOrganization')}
        >
          Create Organisation
        </Button>
      </div>
      <CreateOrganization
        show={modalToShow === 'createOrganization'}
        onHide={() => {
          showModal(null);
          setSelectedRequest(null);
        }}
        request={selectedRequest ?? undefined}
      />
    </div>
  );
}
