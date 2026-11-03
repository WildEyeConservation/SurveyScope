import { cellRows, columnsFromHeadings } from '@/components/cellColumns';
import DataTable from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { useContext, useState } from 'react';
import type { Schema } from './amplify/client-schema';
import { useUsers } from './apiInterface';
import { GlobalContext } from './Context';
import CreateOrganization from './organization/CreateOrganization';
import { useOptimisticUpdates } from './useOptimisticUpdates';

export default function PendingOrganizations() {
  const { client, showModal, modalToShow } = useContext(GlobalContext);
  const { users } = useUsers();

  const [selectedRequest, setSelectedRequest] = useState<
    | (Schema['OrganizationRegistration']['type'] & {
        requestedByEmail: string;
      })
    | null
  >(null);

  const { data: requests } = useOptimisticUpdates<
    Schema['OrganizationRegistration']['type'],
    'OrganizationRegistration'
  >('OrganizationRegistration', async (nextToken) =>
    client.models.OrganizationRegistration.list({
      nextToken,
    }),
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
    {
      content: 'Review Request',
      style: { width: '20%' },
      className: 'text-center',
    },
  ];

  return (
    <>
      <div className='mb-4 flex items-center justify-between'>
        <h5 className='mb-0'>Pending Organisations</h5>
        <Button
          variant='primary'
          onClick={() => showModal('createOrganization')}
        >
          Create Organisation
        </Button>
      </div>
      <DataTable
        columns={columnsFromHeadings(tableHeadings)}
        data={cellRows(tableData)}
        getRowId={(row) => row.id}
        pageSize={10}
        emptyMessage='No pending organisations'
      />
      <CreateOrganization
        show={modalToShow === 'createOrganization'}
        onHide={() => {
          showModal(null);
          setSelectedRequest(null);
        }}
        request={selectedRequest ?? undefined}
      />
    </>
  );
}
