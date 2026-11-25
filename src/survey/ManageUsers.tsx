import DataTable, { type DataColumn } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { SearchIcon } from 'lucide-react';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { GlobalContext } from '../Context';
import { Footer } from '../Modal';
import { useUsers } from '../apiInterface';
import { useLiveChanges } from '../useLiveChanges';
import { fetchAllPaginatedResults } from '../utils';
import { applyProjectMembershipChange } from '../utils/projectMembershipWrites';
import { SectionTitle } from './SurveyStructure';

type Membership = {
  userId: string;
  membershipId: string | null;
  annotationAccess: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
};

type UserPermission = Membership & { userName: string; userEmail: string };

type Level = 'none' | 'annotate' | 'admin';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'annotate', label: 'Annotate' },
  { value: 'admin', label: 'Admin' },
];

const levelOf = (p: Membership): Level =>
  p.isOrgAdmin || p.isAdmin
    ? 'admin'
    : p.annotationAccess
      ? 'annotate'
      : 'none';

export default function ManageUsers({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  const { client, showModal } = useContext(GlobalContext)!;
  const { users, loaded: usersLoaded, reload: reloadUsers } = useUsers();

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [originalMemberships, setOriginalMemberships] = useState<Membership[]>(
    [],
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [search, setSearch] = useState('');
  const [saveResult, setSaveResult] = useState<{
    variant: 'success' | 'danger';
    message: string;
  } | null>(null);

  const loadMemberships = useCallback(
    async (signal?: AbortSignal): Promise<Membership[]> => {
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
          client.models.UserProjectMembership.userProjectMembershipsByProjectId,
          {
            projectId,
            selectionSet: ['id', 'userId', 'isAdmin'] as const,
            signal,
          },
        ),
      ]);
      return orgMemberships.map((orgMembership) => {
        const projectMembership = projectMemberships.find(
          (pm) => pm.userId === orgMembership.userId,
        );
        return {
          userId: orgMembership.userId,
          membershipId: projectMembership?.id ?? null,
          annotationAccess: !!projectMembership,
          isAdmin: !!projectMembership?.isAdmin,
          isOrgAdmin: !!orgMembership.isAdmin,
        };
      });
    },
    [client, projectId, organizationId],
  );

  const loadSeq = useRef(0);
  // Keep live refreshes from invalidating the post-save reload.
  const foreground = useRef(0);
  const livePending = useRef(false);
  const runLive = useRef<() => void>(() => {});
  const fetchData = useCallback(
    async function fetchData(signal?: AbortSignal) {
      const seq = ++loadSeq.current;
      foreground.current += 1;
      try {
        const loaded = await loadMemberships(signal);
        if (seq !== loadSeq.current) return;
        setMemberships(loaded);
        setOriginalMemberships(loaded);
      } finally {
        foreground.current -= 1;
        if (!signal?.aborted) setIsLoading(false);
        if (foreground.current === 0 && livePending.current) {
          livePending.current = false;
          runLive.current();
        }
      }
    },
    [loadMemberships],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal).catch((error) => {
      if (!controller.signal.aborted)
        console.error('Failed to load users', error);
    });
    return () => controller.abort();
  }, [fetchData]);

  // Preserve unsaved permission edits during live refreshes.
  const originalRef = useRef(originalMemberships);
  originalRef.current = originalMemberships;
  runLive.current = async () => {
    if (foreground.current > 0) {
      livePending.current = true;
      return;
    }
    const seq = ++loadSeq.current;
    try {
      const fresh = await loadMemberships();
      if (seq !== loadSeq.current) return;
      const before = originalRef.current;
      setMemberships((current) =>
        fresh.map((row) => {
          const local = current.find((m) => m.userId === row.userId);
          const original = before.find((m) => m.userId === row.userId);
          const edited =
            local &&
            original &&
            (local.annotationAccess !== original.annotationAccess ||
              local.isAdmin !== original.isAdmin);
          return edited
            ? {
                ...row,
                annotationAccess: local.annotationAccess,
                isAdmin: local.isAdmin,
              }
            : row;
        }),
      );
      setOriginalMemberships(fresh);
    } catch (error) {
      console.error('Failed to refresh users', error);
    }
  };
  const liveTimer = useRef<ReturnType<typeof setTimeout>>();
  const onLiveChange = (item: Record<string, unknown>) => {
    if (!users.some((u) => u.id === item.userId)) reloadUsers();
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => runLive.current(), 300);
  };
  useEffect(
    () => () => {
      clearTimeout(liveTimer.current);
      loadSeq.current += 1;
      livePending.current = false;
    },
    [],
  );
  useLiveChanges(
    'OrganizationMembership',
    'organizationId',
    organizationId,
    onLiveChange,
  );
  useLiveChanges('UserProjectMembership', 'projectId', projectId, onLiveChange);

  const permissions = useMemo<UserPermission[]>(() => {
    const byId = new Map(users.map((u) => [u.id, u]));
    return memberships
      .map((m) => ({
        ...m,
        userName: byId.get(m.userId)?.name ?? 'Unknown',
        userEmail: byId.get(m.userId)?.email ?? '',
      }))
      .sort((a, b) =>
        a.isOrgAdmin !== b.isOrgAdmin
          ? a.isOrgAdmin
            ? -1
            : 1
          : a.userName.localeCompare(b.userName),
      );
  }, [memberships, users]);

  const changed = (p: Membership) =>
    !originalMemberships.some(
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

  const update = useCallback((userId: string, change: Partial<Membership>) => {
    setSaveResult(null);
    setMemberships((prev) =>
      prev.map((p) => (p.userId === userId ? { ...p, ...change } : p)),
    );
  }, []);

  const columns = useMemo<DataColumn<UserPermission>[]>(
    () => [
      {
        accessorKey: 'userName',
        header: 'Name',
        cell: ({ row }) => (
          <span className='flex min-w-0 items-center gap-2'>
            <span className='truncate' title={row.original.userName}>
              {row.original.userName}
            </span>
            {row.original.isOrgAdmin && (
              <span className='shrink-0 border border-white/30 px-1.5 text-[11px] leading-5 text-muted-foreground'>
                Organisation admin
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: 'userEmail',
        header: 'Email',
        meta: { className: 'max-w-80 truncate' },
      },
      {
        id: 'access',
        header: 'Access',
        // Sorting by access would move a row while it is being changed.
        enableSorting: false,
        meta: { className: 'w-px text-center' },
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div
              role='radiogroup'
              aria-label={`Access for ${p.userName}`}
              title={
                p.isOrgAdmin
                  ? 'Organisation admins always have full access'
                  : undefined
              }
              className='inline-flex border border-white/30'
            >
              {LEVELS.map(({ value, label }) => (
                <button
                  key={value}
                  type='button'
                  role='radio'
                  aria-checked={levelOf(p) === value}
                  disabled={p.isOrgAdmin || isSaving}
                  onClick={() =>
                    update(p.userId, {
                      annotationAccess: value !== 'none',
                      isAdmin: value === 'admin',
                    })
                  }
                  className={cn(
                    'px-2.5 py-1 transition-colors disabled:opacity-60',
                    levelOf(p) === value
                      ? 'bg-primary text-white'
                      : 'enabled:hover:bg-white/10',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          );
        },
      },
    ],
    [isSaving, update],
  );

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
        <DataTable
          storageKey='survey-members'
          columns={columns}
          data={visible}
          getRowId={(p) => p.userId}
          loading={isLoading || !usersLoaded}
          loadingMessage={
            <span className='flex items-center gap-2'>
              <Spinner animation='border' size='sm' />
              Loading members...
            </span>
          }
          emptyMessage={
            permissions.length ? 'No members match.' : 'No members found.'
          }
          rowClassName={(p) =>
            changed(p)
              ? 'shadow-[inset_3px_0_0_var(--color-primary)]'
              : undefined
          }
        />
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
