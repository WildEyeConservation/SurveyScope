import DataTable, { type DataColumn } from '@/components/DataTable';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { useContext, useMemo, useRef, useState } from 'react';
import { useUsers } from '../apiInterface';
import { TestingContext } from '../Context';

type Filter = 'all' | 'tested' | 'untested';
type Row = { userId: string; name: string; email: string; tested: boolean };

const OPTIONS = [
  { label: 'Not tested', value: false },
  { label: 'Tested', value: true },
];

export default function Users() {
  const { organizationMembershipsHook: hook, organizationId } =
    useContext(TestingContext)!;
  const { users } = useUsers();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // The hook is a new object every render; keep the columns stable.
  const updateRef = useRef(hook.update);
  updateRef.current = hook.update;

  const rows: Row[] = hook.data
    .map((membership) => {
      const user = users.find((u) => u.id === membership.userId);
      return {
        userId: membership.userId,
        name: user?.name ?? 'Unknown user',
        email: user?.email ?? '',
        tested: !!membership.isTested,
      };
    })
    .filter((row) =>
      `${row.name} ${row.email}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .filter((row) =>
      filter === 'all' ? true : (filter === 'tested') === row.tested,
    );
  const tested = hook.data.filter((m) => m.isTested).length;

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { className: 'max-w-64 truncate' },
      },
      {
        accessorKey: 'email',
        header: 'Email',
        meta: { className: 'max-w-80 truncate' },
      },
      {
        accessorKey: 'tested',
        header: 'Test user',
        // Sorting by it would move a row while it is being changed.
        enableSorting: false,
        meta: { className: 'w-48' },
        cell: ({ row }) => (
          <div
            role='radiogroup'
            aria-label={`Test ${row.original.name}`}
            className='inline-flex border border-white/30'
          >
            {OPTIONS.map((option) => (
              <button
                key={option.label}
                type='button'
                role='radio'
                aria-checked={row.original.tested === option.value}
                onClick={() =>
                  row.original.tested !== option.value &&
                  updateRef.current({
                    userId: row.original.userId,
                    organizationId,
                    isTested: option.value,
                  })
                }
                className={cn(
                  'px-3 py-1.5 leading-normal whitespace-nowrap transition-colors',
                  row.original.tested === option.value
                    ? 'bg-primary text-white'
                    : 'hover:bg-white/10',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ),
      },
    ],
    [organizationId],
  );

  return (
    <div className='mt-4 flex w-full flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          type='text'
          placeholder='Search users'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className='w-full sm:w-64'
        />
        <NativeSelect
          aria-label='Filter users'
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className='w-full sm:w-44'
        >
          <option value='all'>Everyone</option>
          <option value='tested'>Tested</option>
          <option value='untested'>Not tested</option>
        </NativeSelect>
        <span className='ml-auto text-sm text-muted-foreground'>
          {tested} of {hook.data.length} tested
        </span>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.userId}
        initialSorting={[{ id: 'name', desc: false }]}
        pageSize={5}
        loading={hook.data.length === 0}
        loadingMessage='Loading users...'
        emptyMessage='No users found.'
      />
    </div>
  );
}
