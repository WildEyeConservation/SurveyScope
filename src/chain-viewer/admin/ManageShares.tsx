import DataTable, { type DataColumn } from '@/components/DataTable';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  Plus,
  RefreshCw,
  Share2,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { isShareOperationBusy } from '../../../amplify/chain-shares/lifecycle';
import type { UserType } from '../../../amplify/shared/types';
import { GlobalContext } from '../../Context';
import { useUsers } from '../../apiInterface';
import { fetchAllPaginatedResults } from '../../utils';
import { checkShareResponse } from './shareResponse';
import { useReviewersByShare } from './useReviewersByShare';

type ShareRow = {
  shareId: string;
  surveyName?: string | null;
  annotationSetName?: string | null;
  annotationSetId: string;
  status?: string | null;
  createdBy?: string | null;
  operationStartedAt?: string | null;
  errorMessage?: string | null;
};

type Option = { label: string; value: string };

/**
 * Sysadmin "Manage Shares" page: provision and manage chain-viewer shares.
 * Snapshots an annotation set into the read-only SharedChain* tables, manages
 * the per-share `chainshare-<shareId>` Cognito group, and revokes.
 *
 * The annotation set is chosen via Survey → Annotation set dropdowns rather
 * than a pasted id. Snapshotting a large set can outrun AppSync's resolver
 * timeout while the Lambda keeps running, so a new share appears in the list
 * once the snapshot finishes — use Refresh.
 */
export default function ManageShares({
  onShowResults,
}: {
  onShowResults: (shareId: string) => void;
}) {
  const { client } = useContext(GlobalContext)!;
  const { users } = useUsers();
  const queryClient = useQueryClient();

  const [surveys, setSurveys] = useState<Option[]>([]);
  const [selectedSurvey, setSelectedSurvey] = useState<Option | null>(null);
  const [sets, setSets] = useState<Option[]>([]);
  const [selectedSet, setSelectedSet] = useState<Option | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyShare, setBusyShare] = useState<string | null>(null);
  const [managing, setManaging] = useState<ShareRow | null>(null);
  const [revoking, setRevoking] = useState<ShareRow | null>(null);

  const {
    data: reviewersByShare,
    isSuccess: reviewersLoaded,
    isFetching: reviewersRefreshing,
    isError: reviewersFailed,
  } = useReviewersByShare(users);

  const userOptions: Option[] = users.map((u) => ({
    label: u.name ? `${u.name} (${u.email ?? u.id})` : (u.email ?? u.id),
    value: u.id,
  }));
  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name ?? u.email ?? u.id);
    return m;
  }, [users]);

  // Load surveys (projects) for the create picker.
  useEffect(() => {
    (async () => {
      try {
        const rows = (await fetchAllPaginatedResults(
          client.models.Project.list,
          {
            selectionSet: ['id', 'name'] as const,
            limit: 10000,
          },
        )) as Array<{ id: string; name: string }>;
        setSurveys(
          rows
            .map((r) => ({ label: r.name, value: r.id }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch (err) {
        console.error('Failed to list surveys', err);
      }
    })();
  }, [client]);

  // Load annotation sets when a survey is selected.
  useEffect(() => {
    setSets([]);
    setSelectedSet(null);
    if (!selectedSurvey) return;
    (async () => {
      try {
        const rows = (await fetchAllPaginatedResults(
          client.models.AnnotationSet.annotationSetsByProjectId,
          {
            projectId: selectedSurvey.value,
            selectionSet: ['id', 'name'] as const,
            limit: 10000,
          },
        )) as Array<{ id: string; name: string }>;
        setSets(
          rows
            .map((r) => ({ label: r.name, value: r.id }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch (err) {
        console.error('Failed to list annotation sets', err);
      }
    })();
  }, [client, selectedSurvey]);

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await fetchAllPaginatedResults(
        async (
          options?: Parameters<typeof client.models.ChainShare.list>[0],
        ) => {
          const result = await client.models.ChainShare.list(options);
          checkShareResponse(result, 'Load shares');
          return result;
        },
        {
          selectionSet: [
            'shareId',
            'surveyName',
            'annotationSetName',
            'annotationSetId',
            'status',
            'createdBy',
            'operationStartedAt',
            'errorMessage',
          ] as const,
          limit: 10000,
        },
      )) as ShareRow[];
      setShares(rows.filter((s) => s.status !== 'revoked'));
    } catch (err) {
      console.error('Failed to list chain shares', err);
      setMessage(
        `Failed to refresh shares: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  const onCreate = useCallback(async () => {
    const setId = selectedSet?.value;
    if (!setId) return;
    setCreating(true);
    setMessage(null);
    try {
      const shareId = crypto.randomUUID();
      const group = `chainshare-${shareId}`;
      checkShareResponse(
        await client.mutations.createGroup({ groupName: group }),
        'Create reviewer group',
      );
      // Fire the snapshot; it may run past the resolver timeout server-side.
      void client.mutations
        .snapshotChainShare({ annotationSetId: setId, shareId })
        .then((result) => {
          checkShareResponse(result, 'Create snapshot');
          setMessage(`Share ${shareId} is ready. You can now add reviewers.`);
        })
        .catch((err: unknown) => {
          setMessage(
            `Snapshot request: ${err instanceof Error ? err.message : String(err)}. Refresh to check the server status; a timeout does not stop creation.`,
          );
        })
        .finally(() => {
          setCreating(false);
          void loadShares();
        });
      setSelectedSet(null);
      setMessage(
        `Snapshot started for "${selectedSet?.label}" (share ${shareId}). Its progress will appear below; use Refresh to check again. Add reviewers once its status is active.`,
      );
    } catch (err) {
      console.error('Failed to start chain share', err);
      setCreating(false);
      setMessage(
        `Failed to create share: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [client, loadShares, selectedSet]);

  const refreshReviewers = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['reviewers-by-share'] });
  }, [queryClient]);

  const onAddReviewer = useCallback(
    async (shareId: string, user: Option) => {
      setBusyShare(shareId);
      try {
        checkShareResponse(
          await client.mutations.addUserToGroup({
            userId: user.value,
            groupName: `chainshare-${shareId}`,
          }),
          'Update reviewer membership',
        );
        setMessage(`Added ${user.label} to share ${shareId}.`);
        refreshReviewers();
      } catch (err) {
        setMessage(
          `Failed to add reviewer: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusyShare(null);
      }
    },
    [client, refreshReviewers],
  );

  const onRemoveReviewer = useCallback(
    async (shareId: string, user: Option) => {
      setBusyShare(shareId);
      try {
        checkShareResponse(
          await client.mutations.removeUserFromGroup({
            userId: user.value,
            groupName: `chainshare-${shareId}`,
          }),
          'Update reviewer membership',
        );
        setMessage(`Removed ${user.label} from share ${shareId}.`);
        refreshReviewers();
      } catch (err) {
        setMessage(
          `Failed to remove reviewer: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusyShare(null);
      }
    },
    [client, refreshReviewers],
  );

  const onRevoke = useCallback(
    async (shareId: string) => {
      setBusyShare(shareId);
      try {
        checkShareResponse(
          await client.mutations.revokeChainShare({ shareId }),
          'Revoke share',
        );
        setMessage(`Share ${shareId} was revoked. Feedback has been retained.`);
        await loadShares();
      } catch (err) {
        setMessage(
          `Failed to revoke: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusyShare(null);
        void loadShares();
      }
    },
    [client, loadShares],
  );

  const operationRunning =
    creating || shares.some((s) => isShareOperationBusy(s));
  useEffect(() => {
    if (!operationRunning) return;
    const interval = setInterval(() => {
      void loadShares();
    }, 5000);
    return () => clearInterval(interval);
  }, [operationRunning, loadShares]);

  const shareName = (share: ShareRow) =>
    `${share.surveyName ?? '—'}, ${share.annotationSetName ?? share.annotationSetId}`;

  const columns: DataColumn<ShareRow>[] = [
    {
      id: 'survey',
      header: 'Survey',
      accessorFn: (share) => share.surveyName ?? '',
      cell: ({ row: { original: share } }) => (
        <div>
          <div className='font-medium'>{share.surveyName ?? '—'}</div>
          <div className='text-sm text-muted-foreground'>
            {share.annotationSetName ?? share.annotationSetId}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (share) => share.status ?? '',
      cell: ({ row: { original: share } }) => {
        const timedOut =
          ['creating', 'revoking'].includes(share.status ?? '') &&
          !isShareOperationBusy(share);
        return (
          <div className='flex flex-col items-start gap-1'>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm',
                share.status === 'active'
                  ? 'bg-success/20 text-success'
                  : 'bg-warning/20 text-warning',
              )}
            >
              {isShareOperationBusy(share) && (
                <Spinner animation='border' size='sm' />
              )}
              {share.status ?? 'unknown'}
            </span>
            {share.errorMessage && (
              <span className='text-sm text-danger'>{share.errorMessage}</span>
            )}
            {timedOut && (
              <span className='text-sm text-warning'>
                Timed out. Remove reviewers, then clean up.
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'reviewers',
      header: 'Reviewers',
      accessorFn: (share) => reviewersByShare?.[share.shareId]?.length ?? 0,
      cell: ({ row: { original: share } }) => {
        const assigned = reviewersByShare?.[share.shareId] ?? [];
        return assigned.length === 0 ? (
          <span className='text-muted-foreground'>
            {reviewersLoaded ? 'None yet' : '…'}
          </span>
        ) : (
          <div className='flex flex-wrap gap-1'>
            {assigned.map((u) => (
              <span
                key={u.id}
                title={u.email ?? u.id}
                className='rounded-full bg-white/15 px-2 py-0.5 text-sm'
              >
                {userNameById.get(u.id) ?? u.id}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row: { original: share } }) => {
        const assigned = reviewersByShare?.[share.shareId] ?? [];
        const recovering = share.status !== 'active';
        return (
          <div className='flex justify-center gap-2'>
            <Button
              variant='outline-light'
              disabled={busyShare === share.shareId || !reviewersLoaded}
              onClick={() => setManaging(share)}
            >
              <UsersRound size={16} />
              Reviewers
            </Button>
            <Button
              variant='outline-light'
              disabled={share.status !== 'active'}
              onClick={() => onShowResults(share.shareId)}
            >
              <BarChart3 size={16} />
              Results
            </Button>
            <span
              title={
                assigned.length > 0
                  ? 'Remove all reviewers before revoking this share.'
                  : undefined
              }
            >
              <Button
                variant='outline-danger'
                disabled={
                  busyShare === share.shareId ||
                  isShareOperationBusy(share) ||
                  assigned.length > 0 ||
                  !reviewersLoaded ||
                  reviewersRefreshing
                }
                onClick={() => setRevoking(share)}
              >
                {recovering ? 'Clean up' : 'Revoke'}
              </Button>
            </span>
          </div>
        );
      },
      meta: { className: 'w-px text-center' },
    },
  ];

  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader className='py-3'>
          <div className='font-semibold'>New share</div>
        </CardHeader>
        <CardContent>
          <form
            className='flex flex-wrap items-end gap-2'
            onSubmit={(e) => {
              e.preventDefault();
              void onCreate();
            }}
          >
            <div className='min-w-64 flex-1'>
              <Label className='mb-1'>Survey</Label>
              <Combobox
                value={selectedSurvey}
                onChange={(option) => setSelectedSurvey(option)}
                options={surveys}
                placeholder='Select a survey…'
                clearable
                name='Survey'
              />
            </div>
            <div className='min-w-64 flex-1'>
              <Label className='mb-1'>Annotation set</Label>
              <Combobox
                value={selectedSet}
                onChange={(option) => setSelectedSet(option)}
                options={sets}
                placeholder={
                  selectedSurvey
                    ? 'Select an annotation set…'
                    : 'Select a survey first'
                }
                disabled={!selectedSurvey}
                clearable
                name='Annotation set'
              />
            </div>
            <Button type='submit' disabled={creating || !selectedSet}>
              {creating ? (
                <Spinner animation='border' size='sm' />
              ) : (
                <Share2 size={16} />
              )}
              Create share
            </Button>
          </form>
        </CardContent>
      </Card>

      {message && (
        <Alert variant='info' onClose={() => setMessage(null)} className='mb-0'>
          {message}
        </Alert>
      )}
      {reviewersFailed && (
        <Alert variant='danger' className='mb-0'>
          Could not load reviewer membership. Refresh before revoking a share.
        </Alert>
      )}

      <div className='flex items-center justify-between gap-2'>
        <h5 className='mb-0'>Shares</h5>
        <Button
          variant='outline-primary'
          disabled={loading || reviewersRefreshing}
          onClick={() => {
            void loadShares();
            refreshReviewers();
          }}
        >
          <RefreshCw
            size={16}
            className={cn((loading || reviewersRefreshing) && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>
      <DataTable
        storageKey='chain-shares'
        columns={columns}
        data={shares}
        getRowId={(share) => share.shareId}
        pageSize={false}
        initialSorting={[{ id: 'survey', desc: false }]}
        loading={loading && shares.length === 0}
        loadingMessage='Loading shares…'
        emptyIcon={Share2}
        emptyMessage='No shares yet. Create one above.'
      />

      <ReviewersDialog
        share={managing}
        title={managing ? shareName(managing) : ''}
        reviewers={managing ? (reviewersByShare?.[managing.shareId] ?? []) : []}
        userOptions={userOptions}
        userNameById={userNameById}
        busy={!!managing && busyShare === managing.shareId}
        onAdd={(user) => managing && void onAddReviewer(managing.shareId, user)}
        onRemove={(user) =>
          managing && void onRemoveReviewer(managing.shareId, user)
        }
        onClose={() => setManaging(null)}
      />

      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader closeButton>
            <DialogTitle>
              {revoking?.status === 'active'
                ? 'Revoke share'
                : 'Clean up share'}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            {revoking && shareName(revoking)}: this deletes the snapshot data.
            Reviewer feedback is kept.
          </DialogBody>
          <DialogFooter>
            <Button
              variant='ghost'
              className='mr-auto'
              onClick={() => setRevoking(null)}
            >
              Cancel
            </Button>
            <Button
              variant='danger'
              onClick={() => {
                if (revoking) void onRevoke(revoking.shareId);
                setRevoking(null);
              }}
            >
              {revoking?.status === 'active' ? 'Revoke' : 'Clean up'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewersDialog(props: {
  share: ShareRow | null;
  title: string;
  reviewers: UserType[];
  userOptions: Option[];
  userNameById: Map<string, string>;
  busy: boolean;
  onAdd: (user: Option) => void;
  onRemove: (user: Option) => void;
  onClose: () => void;
}) {
  const [toAdd, setToAdd] = useState<Option | null>(null);
  const [confirming, setConfirming] = useState(false);
  const assignedIds = new Set(props.reviewers.map((u) => u.id));
  const available = props.userOptions.filter((o) => !assignedIds.has(o.value));
  const active = props.share?.status === 'active';
  const close = () => {
    setConfirming(false);
    setToAdd(null);
    props.onClose();
  };

  return (
    <Dialog open={!!props.share} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader closeButton>
          <DialogTitle>Reviewers</DialogTitle>
        </DialogHeader>
        <DialogBody className='flex flex-col gap-4'>
          <div className='text-muted-foreground'>{props.title}</div>
          {props.reviewers.length === 0 ? (
            <div className='text-muted-foreground'>No reviewers yet.</div>
          ) : (
            <div className='flex flex-col gap-1'>
              {props.reviewers.map((u) => {
                const name = props.userNameById.get(u.id) ?? u.id;
                return (
                  <div
                    key={u.id}
                    className='flex items-center gap-3 bg-black/15 px-3 py-2'
                  >
                    <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/25 font-semibold text-primary uppercase'>
                      {name.charAt(0)}
                    </span>
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium'>{name}</div>
                      {u.email && (
                        <div className='truncate text-sm text-muted-foreground'>
                          {u.email}
                        </div>
                      )}
                    </div>
                    <button
                      type='button'
                      disabled={props.busy}
                      title={`Remove ${name}`}
                      aria-label={`Remove ${name}`}
                      onClick={() =>
                        props.onRemove({ value: u.id, label: name })
                      }
                      className='rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-danger/20 hover:text-danger disabled:opacity-50'
                    >
                      <X size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {confirming && toAdd ? (
            <div className='flex flex-col gap-3 border border-warning/60 bg-warning/10 p-3'>
              <div>
                Give <strong>{toAdd.label}</strong> access to {props.title}?
                They will be able to open the chain viewer for this share and
                record feedback.
              </div>
              <div className='flex justify-end gap-2'>
                <Button
                  variant='ghost'
                  className='mr-auto'
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={props.busy}
                  onClick={() => {
                    props.onAdd(toAdd);
                    setToAdd(null);
                    setConfirming(false);
                  }}
                >
                  <Plus size={16} />
                  Add reviewer
                </Button>
              </div>
            </div>
          ) : (
            <div className='flex items-end gap-2'>
              <div className='min-w-0 flex-1'>
                <Label className='mb-1'>Add a reviewer</Label>
                <Combobox
                  value={toAdd}
                  onChange={setToAdd}
                  options={available}
                  placeholder={
                    active ? 'Select an account…' : 'Share is not active'
                  }
                  disabled={!active}
                  clearable
                  name='Reviewer account'
                />
              </div>
              <Button
                disabled={!active || !toAdd || props.busy}
                onClick={() => setConfirming(true)}
              >
                {props.busy ? (
                  <Spinner animation='border' size='sm' />
                ) : (
                  <Plus size={16} />
                )}
                Add
              </Button>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant='ghost' className='mr-auto' onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
