import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { SearchIcon } from 'lucide-react';
import { useCallback, useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { useUsers } from '../apiInterface';
import { fetchAllPaginatedResults } from '../utils';
import { applyProjectMembershipChange } from '../utils/projectMembershipWrites';
import { SectionTitle } from './SurveyStructure';

type UserPermission = {
  userId: string;
  userName: string;
  userEmail: string;
  membershipId: string | null;
  annotationAccess: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
};

const GRID = 'minmax(0, 1fr) minmax(0, 1.3fr) 110px 110px';

export default function ManageUsers({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { client, showModal } = useContext(GlobalContext)!;
  const { users } = useUsers();

  const [permissions, setPermissions] = useState<UserPermission[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<
    UserPermission[]
  >([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [search, setSearch] = useState('');
  const [saveResult, setSaveResult] = useState<{
    variant: 'success' | 'danger';
    message: string;
  } | null>(null);

  const fetchData = useCallback(
    async function fetchData(signal?: AbortSignal) {
      if (!users) return;
      setIsLoading(true);

      try {
        const [orgMemberships, projectMemberships] = await Promise.all([
          fetchAllPaginatedResults(
            client.models.OrganizationMembership.membershipsByOrganizationId,
            {
              organizationId,
              selectionSet: ['userId', 'isAdmin'] as const,
              signal,
            },
          ),
          fetchAllPaginatedResults(
            client.models.UserProjectMembership
              .userProjectMembershipsByProjectId,
            {
              projectId,
              selectionSet: ['id', 'userId', 'isAdmin'] as const,
              signal,
            },
          ),
        ]);

        const userPermissions: UserPermission[] = orgMemberships.map(
          (orgMembership) => {
            const user = users.find((u) => u.id === orgMembership.userId);
            const projectMembership = projectMemberships.find(
              (pm) => pm.userId === orgMembership.userId,
            );

            return {
              userId: orgMembership.userId,
              userName: user?.name ?? 'Unknown',
              userEmail: user?.email ?? '',
              membershipId: projectMembership?.id ?? null,
              annotationAccess: !!projectMembership,
              isAdmin: !!projectMembership?.isAdmin,
              isOrgAdmin: !!orgMembership.isAdmin,
            };
          },
        );

        // Sort: org admins first, then alphabetically by name
        userPermissions.sort((a, b) => {
          if (a.isOrgAdmin !== b.isOrgAdmin) return a.isOrgAdmin ? -1 : 1;
          return a.userName.localeCompare(b.userName);
        });

        setPermissions(userPermissions);
        setOriginalPermissions(userPermissions);
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [users, client, projectId, organizationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal).catch((error) => {
      if (!controller.signal.aborted)
        console.error('Failed to load users', error);
    });
    return () => controller.abort();
  }, [fetchData]);

  const changed = (p: UserPermission) =>
    !originalPermissions.some(
      (op) =>
        op.userId === p.userId &&
        op.annotationAccess === p.annotationAccess &&
        op.isAdmin === p.isAdmin,
    );
  const changedCount = permissions.filter(changed).length;
  const hasChanges = changedCount > 0;

  // Returns true only when every change was written.
  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);

    const permissionsToUpdate = permissions.filter(changed);

    // Keep going past a failed user so one rejection doesn't silently skip
    // everyone after it; report exactly who didn't save.
    const failed: string[] = [];
    for (const permission of permissionsToUpdate) {
      try {
        await applyProjectMembershipChange(client, {
          userId: permission.userId,
          projectId,
          membershipId: permission.membershipId,
          annotationAccess: permission.annotationAccess,
          isAdmin: permission.isAdmin,
          group: organizationId,
        });
      } catch (err) {
        console.error(
          `Failed to save survey access for user ${permission.userId}`,
          err,
        );
        failed.push(permission.userName);
      }
    }

    try {
      // Refetch so the toggles show what was actually saved.
      await fetchData();
    } catch (err) {
      console.error('Failed to reload survey access', err);
    }

    setSaveResult(
      failed.length > 0
        ? {
            variant: 'danger',
            message: `Could not save access for: ${failed.join(', ')}. Please try again.`,
          }
        : { variant: 'success', message: 'Access saved.' },
    );
    setIsSaving(false);
    return failed.length === 0;
  };

  const handleSaveAndClose = async () => {
    setConfirmingClose(false);
    // Stay open on failure so the error is seen.
    if (await handleSave()) showModal(null);
  };

  const update = (userId: string, change: Partial<UserPermission>) => {
    setSaveResult(null);
    setPermissions((prev) =>
      prev.map((p) => (p.userId === userId ? { ...p, ...change } : p)),
    );
  };

  const query = search.trim().toLowerCase();
  const visible = query
    ? permissions.filter(
        (p) =>
          p.userName.toLowerCase().includes(query) ||
          p.userEmail.toLowerCase().includes(query),
      )
    : permissions;

  return (
    <>
      <div className='flex flex-col gap-2 p-4'>
        <SectionTitle className='border-b-0 pb-0'>Members</SectionTitle>
        <div className='relative'>
          <SearchIcon className='pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-[#6c757d]' />
          <Input
            type='search'
            aria-label='Find a member'
            placeholder='Find a member by name or email…'
            className='pl-9'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className='border border-white/15 bg-white/[0.07] text-sm'>
          <div
            className='grid gap-3 border-b border-white/15 bg-black/15 px-3 py-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'
            style={{ gridTemplateColumns: GRID }}
          >
            <span>Name</span>
            <span>Email</span>
            <span className='text-center'>Can annotate</span>
            <span className='text-center'>Survey admin</span>
          </div>
          <div className='max-h-[26rem] overflow-y-auto'>
            {isLoading ? (
              <div className='flex items-center gap-2 px-3 py-3 text-muted-foreground'>
                <Spinner animation='border' size='sm' />
                Loading members...
              </div>
            ) : visible.length === 0 ? (
              <div className='px-3 py-3 text-muted-foreground italic'>
                {permissions.length ? 'No members match.' : 'No members found.'}
              </div>
            ) : (
              visible.map((p) => (
                <div
                  key={p.userId}
                  className={cn(
                    'grid items-center gap-3 border-b border-white/[0.08] px-3 py-2 last:border-b-0',
                    changed(p) && 'shadow-[inset_3px_0_0_var(--color-primary)]',
                  )}
                  style={{ gridTemplateColumns: GRID }}
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    <span className='truncate' title={p.userName}>
                      {p.userName}
                    </span>
                    {p.isOrgAdmin && (
                      <span className='shrink-0 border border-white/30 px-1.5 text-[11px] leading-5 text-muted-foreground'>
                        Organisation admin
                      </span>
                    )}
                  </span>
                  <span
                    className='truncate text-muted-foreground'
                    title={p.userEmail}
                  >
                    {p.userEmail}
                  </span>
                  <span
                    className='flex justify-center'
                    title={
                      p.isOrgAdmin
                        ? 'Organisation admins always have full access'
                        : p.isAdmin
                          ? 'Survey admins can always annotate'
                          : undefined
                    }
                  >
                    <Switch
                      aria-label={`${p.userName} can annotate`}
                      checked={p.annotationAccess}
                      disabled={p.isOrgAdmin || p.isAdmin || isSaving}
                      onCheckedChange={(checked) =>
                        update(p.userId, { annotationAccess: checked })
                      }
                    />
                  </span>
                  <span
                    className='flex justify-center'
                    title={
                      p.isOrgAdmin
                        ? 'Organisation admins always have full access'
                        : undefined
                    }
                  >
                    <Switch
                      aria-label={`${p.userName} is a survey admin`}
                      checked={p.isAdmin}
                      disabled={p.isOrgAdmin || isSaving}
                      onCheckedChange={(checked) =>
                        update(p.userId, {
                          isAdmin: checked,
                          annotationAccess: checked || p.annotationAccess,
                        })
                      }
                    />
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
        {saveResult?.variant === 'danger' && (
          <div className='text-xs text-danger'>{saveResult.message}</div>
        )}
      </div>
      <Footer>
        {confirmingClose ? (
          <>
            <div className='mr-auto'>
              <div>Close without saving?</div>
              <div className='text-xs text-muted-foreground'>
                {changedCount} member{changedCount === 1 ? '' : 's'} changed.
              </div>
            </div>
            <Button
              variant='outline-light'
              onClick={() => setConfirmingClose(false)}
            >
              Keep editing
            </Button>
            <Button variant='danger' onClick={() => showModal(null)}>
              Discard
            </Button>
            <Button variant='primary' onClick={handleSaveAndClose}>
              Save and close
            </Button>
          </>
        ) : (
          <>
            <Button
              variant='ghost'
              className='mr-auto'
              onClick={() =>
                hasChanges ? setConfirmingClose(true) : showModal(null)
              }
              disabled={isSaving}
            >
              Close
            </Button>
            {hasChanges ? (
              <span className='text-xs text-warning'>
                ● {changedCount} member{changedCount === 1 ? '' : 's'} changed
              </span>
            ) : (
              saveResult?.variant === 'success' && (
                <span className='text-xs text-success'>Saved</span>
              )
            )}
            <Button
              variant='primary'
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              {isSaving ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        )}
      </Footer>
    </>
  );
}
