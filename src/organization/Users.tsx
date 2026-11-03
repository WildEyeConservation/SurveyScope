import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Trash2Icon, UserPlusIcon } from 'lucide-react';
import { useCallback, useContext, useMemo, useState } from 'react';
import ConfirmationModal from '../ConfirmationModal';
import { GlobalContext, UserContext } from '../Context';
import { Schema } from '../amplify/client-schema';
import { useUsers } from '../apiInterface';
import ExceptionsModal from './ExceptionsModal';
import InviteUserModal from './InviteUserModal';

type Row = {
  userId: string;
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  isSelf: boolean;
};

export default function Users({
  organization,
}: {
  organization: { id: string; name: string };
}) {
  const { client, showModal, modalToShow } = useContext(GlobalContext)!;
  const { user: authUser } = useContext(UserContext)!;
  const { users } = useUsers();

  const {
    data: memberships,
    isLoading: membershipsLoading,
    refetch,
    isFetching,
  } = useQuery<Schema['OrganizationMembership']['type'][]>({
    queryKey: ['OrganizationMembership', organization.id],
    queryFn: async () => {
      const allItems: Schema['OrganizationMembership']['type'][] = [];
      let nextToken: string | undefined;
      do {
        const result =
          await client.models.OrganizationMembership.membershipsByOrganizationId(
            { organizationId: organization.id },
            { nextToken },
          );
        allItems.push(...result.data);
        nextToken = result.nextToken ?? undefined;
      } while (nextToken);
      return allItems;
    },
  });

  const isLoading = !users || membershipsLoading;
  const [userToEdit, setUserToEdit] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [search, setSearch] = useState('');
  const [isMutating, setIsMutating] = useState(false);

  const updateUser = useCallback(
    async (userId: string, isAdmin: boolean) => {
      setIsMutating(true);
      try {
        const { errors } = await client.mutations.updateOrganizationMemberAdmin(
          {
            organizationId: organization.id,
            userId,
            isAdmin,
          },
        );
        if (errors?.length) {
          alert(errors[0].message);
          return;
        }
        await refetch();
      } catch (err: any) {
        alert(err.message ?? 'Failed to update admin status');
      } finally {
        setIsMutating(false);
      }
    },
    [client, organization.id, refetch],
  );

  async function handleRemoveUser() {
    setIsMutating(true);
    try {
      const { errors } = await client.mutations.removeUserFromOrganization({
        organizationId: organization.id,
        userId: userToEdit!.id,
      });

      if (errors?.length) {
        alert(errors[0].message);
        return;
      }
      refetch();
    } catch (err: any) {
      alert(err.message ?? 'Failed to remove user');
    } finally {
      setIsMutating(false);
    }
  }

  const rows: Row[] = (memberships ?? [])
    .map((membership) => {
      const user = users.find((user) => user.id === membership.userId);
      return {
        userId: membership.userId,
        id: user?.id || '',
        name: user?.name ?? 'Unknown user',
        email: user?.email ?? '',
        isAdmin: !!membership.isAdmin,
        isSelf: membership.userId === authUser.userId,
      };
    })
    .filter((row) =>
      `${row.name} ${row.email}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    );

  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        meta: { className: 'max-w-64 truncate' },
        cell: ({ row }) => (
          <>
            {row.original.name}
            {row.original.isSelf && (
              <span className='ml-1.5 bg-white/15 px-1.5 text-[10px]'>you</span>
            )}
          </>
        ),
      },
      {
        accessorKey: 'email',
        header: 'Email',
        meta: { className: 'max-w-80 truncate' },
      },
      {
        accessorKey: 'isAdmin',
        header: 'Role',
        cell: ({ row }) => {
          const { userId, name, isAdmin, isSelf } = row.original;
          return (
            <div
              role='radiogroup'
              aria-label={`Role of ${name}`}
              className='inline-flex w-fit border border-white/30'
            >
              {[
                { label: 'Member', value: false },
                { label: 'Admin', value: true },
              ].map((option) => (
                <button
                  key={option.label}
                  type='button'
                  role='radio'
                  aria-checked={isAdmin === option.value}
                  disabled={isMutating || isSelf}
                  onClick={() =>
                    isAdmin !== option.value && updateUser(userId, option.value)
                  }
                  className={cn(
                    'px-2.5 py-1 transition-colors disabled:opacity-60',
                    isAdmin === option.value
                      ? 'bg-primary text-white'
                      : 'enabled:hover:bg-white/10',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          );
        },
      },
      {
        id: 'access',
        header: 'Survey access',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isAdmin && process.env.NODE_ENV !== 'development' ? (
            <span className='text-muted-foreground'>All surveys</span>
          ) : (
            <Button
              variant='info'
              onClick={() => {
                setUserToEdit({ id: row.original.id, name: row.original.name });
                showModal('exceptions');
              }}
            >
              Permission exceptions
            </Button>
          ),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        meta: { className: 'w-24 text-center' },
        cell: ({ row }) =>
          !row.original.isSelf && (
            <button
              type='button'
              aria-label={`Remove ${row.original.name}`}
              title='Remove from organisation'
              disabled={isMutating}
              onClick={() => {
                setUserToEdit({ id: row.original.id, name: row.original.name });
                showModal('removeUser');
              }}
              className='inline-flex size-8 items-center justify-center text-muted-foreground hover:text-danger disabled:opacity-50'
            >
              <Trash2Icon className='size-4' />
            </button>
          ),
      },
    ],
    [isMutating, updateUser, showModal],
  );

  return (
    <>
      <div className='mt-4 flex flex-col gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            type='text'
            placeholder='Search users'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='w-full sm:w-64'
          />
          <Button
            variant='link'
            className='p-0 text-muted-foreground'
            onClick={() => refetch()}
            disabled={isFetching}
            title='Refresh'
          >
            <RefreshCw
              size={16}
              className={isFetching ? 'spinning' : undefined}
            />
          </Button>
          <Button
            variant='primary'
            className='ml-auto'
            onClick={() => showModal('inviteUser')}
          >
            <UserPlusIcon className='size-4' />
            Invite user
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.userId}
          initialSorting={[{ id: 'name', desc: false }]}
          loading={isLoading}
          loadingMessage='Loading users...'
          emptyMessage='No users found.'
          minWidth={820}
        />
      </div>
      <InviteUserModal
        organization={organization}
        show={modalToShow === 'inviteUser'}
      />
      {userToEdit && (
        <ExceptionsModal
          show={modalToShow === 'exceptions'}
          onClose={() => {
            showModal(null);
            setUserToEdit(null);
          }}
          user={userToEdit}
          organization={organization}
        />
      )}
      <ConfirmationModal
        show={modalToShow === 'removeUser'}
        onClose={() => {
          showModal(null);
          setUserToEdit(null);
        }}
        onConfirm={handleRemoveUser}
        title='Remove User'
        body={`Remove ${userToEdit?.name ?? 'this user'} from ${organization.name}?`}
      />
    </>
  );
}
