import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Trash2Icon, UserPlusIcon } from 'lucide-react';
import { useContext, useState } from 'react';
import ConfirmationModal from '../ConfirmationModal';
import { GlobalContext, UserContext } from '../Context';
import { Schema } from '../amplify/client-schema';
import { useUsers } from '../apiInterface';
import ExceptionsModal from './ExceptionsModal';
import InviteUserModal from './InviteUserModal';

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

  async function updateUser(userId: string, isAdmin: boolean) {
    setIsMutating(true);
    try {
      const { errors } = await client.mutations.updateOrganizationMemberAdmin({
        organizationId: organization.id,
        userId,
        isAdmin,
      });
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
  }

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

  const rows = (memberships ?? [])
    .map((membership) => ({
      membership,
      user: users.find((user) => user.id === membership.userId),
    }))
    .filter(({ user }) =>
      `${user?.name ?? ''} ${user?.email ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? ''));

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

        <div className='overflow-x-auto border border-dark bg-white/[0.07] text-sm'>
          <div className='grid min-w-[820px] grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(150px,1fr)_minmax(190px,1fr)_80px] items-center gap-3 border-b border-dark bg-dark px-3 py-2 text-[11px] font-semibold tracking-wider text-white/85 uppercase'>
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Survey access</span>
            <span className='text-right'>Actions</span>
          </div>
          {isLoading ? (
            <div className='px-3 py-3 text-muted-foreground'>
              Loading users...
            </div>
          ) : rows.length === 0 ? (
            <div className='px-3 py-3 text-muted-foreground italic'>
              No users found.
            </div>
          ) : (
            rows.map(({ membership, user }) => {
              const isSelf = membership.userId === authUser.userId;
              const isAdmin = !!membership.isAdmin;
              return (
                <div
                  key={membership.userId}
                  className='grid min-w-[820px] grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(150px,1fr)_minmax(190px,1fr)_80px] items-center gap-3 border-b border-white/[0.08] px-3 py-2 last:border-b-0'
                >
                  <div className='truncate'>
                    {user?.name ?? 'Unknown user'}
                    {isSelf && (
                      <span className='ml-1.5 bg-white/15 px-1.5 text-[10px]'>
                        you
                      </span>
                    )}
                  </div>
                  <div className='truncate' title={user?.email ?? undefined}>
                    {user?.email}
                  </div>
                  <div
                    role='radiogroup'
                    aria-label={`Role of ${user?.name ?? 'user'}`}
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
                          isAdmin !== option.value &&
                          updateUser(membership.userId, option.value)
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
                  <div>
                    {isAdmin && process.env.NODE_ENV !== 'development' ? (
                      <span className='text-muted-foreground'>All surveys</span>
                    ) : (
                      <Button
                        variant='info'
                        size='sm'
                        onClick={() => {
                          setUserToEdit({
                            id: user?.id || '',
                            name: user?.name || '',
                          });
                          showModal('exceptions');
                        }}
                      >
                        Permission exceptions
                      </Button>
                    )}
                  </div>
                  <div className='flex justify-end'>
                    {!isSelf && (
                      <button
                        type='button'
                        aria-label={`Remove ${user?.name ?? 'user'}`}
                        title='Remove from organisation'
                        disabled={isMutating}
                        onClick={() => {
                          setUserToEdit({
                            id: user?.id || '',
                            name: user?.name || '',
                          });
                          showModal('removeUser');
                        }}
                        className='flex size-8 items-center justify-center text-muted-foreground hover:text-danger disabled:opacity-50'
                      >
                        <Trash2Icon className='size-4' />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
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
