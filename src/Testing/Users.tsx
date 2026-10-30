import { useContext } from 'react';
import { useUsers } from '../apiInterface';
import { TestingContext } from '../Context';
import LabeledToggleSwitch from '../LabeledToggleSwitch';
import MyTable from '../Table';

export default function Users() {
  const { organizationMembershipsHook: hook, organizationId } =
    useContext(TestingContext)!;
  const { users } = useUsers();

  const tableData = hook.data.map((membership) => {
    const user = users.find((user) => user.id === membership.userId);
    return {
      id: membership.userId,
      rowData: [
        user?.name,
        <LabeledToggleSwitch
          className='mb-0'
          leftLabel='No'
          rightLabel='Yes'
          checked={membership.isTested ?? false}
          onChange={async (checked) => {
            hook.update({
              userId: membership.userId,
              organizationId,
              isTested: checked,
            });
          }}
        />,
      ],
    };
  });

  return (
    <div className='mt-4 flex w-full flex-col gap-2'>
      <h5 className='mb-0'>Organisation Users</h5>
      <MyTable
        tableHeadings={[
          { content: 'Name', style: { width: '50%' }, sort: true },
          { content: 'Test User' },
        ]}
        tableData={tableData}
        pagination={true}
        itemsPerPage={5}
        emptyMessage='Loading users...'
      />
    </div>
  );
}
