import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCallback, useContext, useEffect, useState } from 'react';
import { GlobalContext } from '../Context';
import { Body, Footer, Header, Modal, Title } from '../Modal';
import { fetchAllPaginatedResults } from '../utils';
import { applyProjectMembershipChange } from '../utils/projectMembershipWrites';

type Level = 'none' | 'annotate' | 'admin';
const LEVELS: { value: Level; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'annotate', label: 'Annotate' },
  { value: 'admin', label: 'Admin' },
];

type Permission = {
  membershipId: string | null;
  projectName: string;
  projectId: string;
  annotationAccess: boolean;
  isAdmin: boolean;
};

export default function ExceptionsModal({
  show,
  onClose,
  user,
  organization,
}: {
  show: boolean;
  onClose: () => void;
  user: { id: string; name: string };
  organization: { id: string; name: string };
}) {
  const { client } = useContext(GlobalContext)!;

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [originalPermissions, setOriginalPermissions] = useState<Permission[]>(
    [],
  );
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyWithAccess, setOnlyWithAccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    variant: 'success' | 'danger';
    message: string;
  } | null>(null);

  const fetchProjects = useCallback(async () => {
    setIsLoading(true);
    try {
      const projects = await fetchAllPaginatedResults(
        client.models.Project.list,
        {
          selectionSet: ['id', 'name', 'status'],
          filter: {
            organizationId: {
              eq: organization.id,
            },
          },
        },
      );

      const validProjects = projects.filter(
        (project) => project.status !== 'deleted',
      );

      if (validProjects.length > 0) {
        const userProjectMemberships = await fetchAllPaginatedResults(
          client.models.UserProjectMembership.userProjectMembershipsByUserId,
          {
            userId: user.id,
            selectionSet: ['id', 'projectId', 'isAdmin'],
          },
        );

        const projectPermissions = validProjects.map((project) => {
          const membership = userProjectMemberships.find(
            (m) => m.projectId === project.id,
          );
          return {
            projectName: project.name,
            projectId: project.id,
            membershipId: membership?.id ?? null,
            annotationAccess: !!membership,
            isAdmin: !!membership?.isAdmin,
          };
        });

        setOriginalPermissions(projectPermissions);
        setPermissions(projectPermissions);
      }
    } finally {
      setIsLoading(false);
    }
  }, [client, organization.id, user.id]);

  useEffect(() => {
    if (show) {
      fetchProjects();
    } else {
      setPermissions([]);
      setOriginalPermissions([]);
      setSaveResult(null);
    }
  }, [show, fetchProjects]);

  const handleClose = () => {
    if (
      hasChanges &&
      !window.confirm(
        'You have unsaved changes. Close without saving? Click Save first to apply them.',
      )
    ) {
      return;
    }
    onClose();
  };

  const levelOf = (p: Permission): Level =>
    p.isAdmin ? 'admin' : p.annotationAccess ? 'annotate' : 'none';
  const setLevel = (projectId: string, level: Level) => {
    setSaveResult(null);
    setPermissions((current) =>
      current.map((p) =>
        p.projectId === projectId
          ? {
              ...p,
              annotationAccess: level !== 'none',
              isAdmin: level === 'admin',
            }
          : p,
      ),
    );
  };
  const changeCount = permissions.filter(
    (p) =>
      !originalPermissions.some(
        (op) =>
          op.projectId === p.projectId &&
          op.annotationAccess === p.annotationAccess &&
          op.isAdmin === p.isAdmin,
      ),
  ).length;
  const hasChanges = changeCount > 0;
  const withAccess = permissions.filter((p) => p.annotationAccess).length;
  const visible = permissions
    .filter((p) => !onlyWithAccess || p.annotationAccess)
    .filter((p) =>
      p.projectName.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => a.projectName.localeCompare(b.projectName));

  const handleSave = async () => {
    setIsSaving(true);
    setSaveResult(null);

    const permissionsToUpdate = permissions.filter(
      (p) =>
        !originalPermissions.some(
          (op) =>
            op.projectId === p.projectId &&
            op.annotationAccess === p.annotationAccess &&
            op.isAdmin === p.isAdmin,
        ),
    );

    // Keep going past a failed survey so one rejection doesn't silently skip
    // the rest; report exactly which surveys didn't save.
    const failed: string[] = [];
    for (const permission of permissionsToUpdate) {
      try {
        await applyProjectMembershipChange(client, {
          userId: user.id,
          projectId: permission.projectId,
          membershipId: permission.membershipId,
          annotationAccess: permission.annotationAccess,
          isAdmin: permission.isAdmin,
          group: organization.id,
        });
      } catch (err) {
        console.error(
          `Failed to save access to survey ${permission.projectId} for user ${user.id}`,
          err,
        );
        failed.push(permission.projectName);
      }
    }

    try {
      // Reload so the toggles show what was actually saved.
      await fetchProjects();
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
  };

  return (
    <Modal show={show} strict={true} size='lg'>
      <Header>
        <Title>Permission exceptions · {user.name}</Title>
      </Header>
      <Body>
        <div className='flex flex-col gap-3 p-4'>
          <span className='text-sm text-muted-foreground'>
            Choose which of {organization.name}&apos;s surveys this person can
            annotate or administer.
          </span>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              type='text'
              placeholder='Search surveys'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='w-full sm:w-64'
            />
            <div
              role='radiogroup'
              aria-label='Surveys to show'
              className='ml-auto inline-flex border border-white/30'
            >
              {[
                { label: `All ${permissions.length}`, value: false },
                { label: `With access ${withAccess}`, value: true },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type='button'
                  role='radio'
                  aria-checked={onlyWithAccess === option.value}
                  onClick={() => setOnlyWithAccess(option.value)}
                  className={cn(
                    'px-3 py-1.5 leading-normal transition-colors',
                    onlyWithAccess === option.value
                      ? 'bg-primary text-white'
                      : 'hover:bg-white/10',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className='border border-dark bg-white/[0.07] text-sm'>
            <div className='flex justify-between border-b border-dark bg-dark px-3 py-2 text-[11px] font-semibold tracking-wider text-white/85 uppercase'>
              <span>Survey</span>
              <span>Access</span>
            </div>
            <div className='max-h-[50vh] overflow-y-auto'>
              {isLoading ? (
                <div className='px-3 py-3 text-muted-foreground'>
                  Loading surveys...
                </div>
              ) : visible.length === 0 ? (
                <div className='px-3 py-3 text-muted-foreground italic'>
                  No surveys found.
                </div>
              ) : (
                visible.map((permission) => (
                  <div
                    key={permission.projectId}
                    className='flex items-center justify-between gap-3 border-b border-white/[0.08] px-3 py-1.5 last:border-b-0'
                  >
                    <span className='truncate' title={permission.projectName}>
                      {permission.projectName}
                    </span>
                    <div
                      role='radiogroup'
                      aria-label={`Access to ${permission.projectName}`}
                      className='inline-flex flex-none border border-white/30'
                    >
                      {LEVELS.map(({ value, label }) => (
                        <button
                          key={value}
                          type='button'
                          role='radio'
                          aria-checked={levelOf(permission) === value}
                          disabled={isSaving}
                          onClick={() => setLevel(permission.projectId, value)}
                          className={cn(
                            'px-2.5 py-1 transition-colors disabled:opacity-60',
                            levelOf(permission) === value
                              ? 'bg-primary text-white'
                              : 'enabled:hover:bg-white/10',
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          {saveResult && (
            <Alert variant={saveResult.variant} className='mb-0'>
              {saveResult.message}
            </Alert>
          )}
        </div>
      </Body>
      <Footer>
        <Button
          variant='ghost'
          className='mr-auto'
          onClick={handleClose}
          disabled={isSaving}
        >
          {hasChanges ? 'Cancel' : 'Close'}
        </Button>
        {changeCount > 0 && (
          <span className='text-xs text-muted-foreground'>
            {changeCount} {changeCount === 1 ? 'change' : 'changes'}
          </span>
        )}
        <Button
          variant='primary'
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </Footer>
    </Modal>
  );
}
