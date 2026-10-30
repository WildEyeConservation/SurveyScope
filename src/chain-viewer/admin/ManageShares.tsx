import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Table } from '@/components/ui/table';
import { RotateCw } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import './admin.css';

import { useQueryClient } from '@tanstack/react-query';
import { isShareOperationBusy } from '../../../amplify/chain-shares/lifecycle';
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
export default function ManageShares() {
  const { client } = useContext(GlobalContext)!;
  const { users } = useUsers();
  const queryClient = useQueryClient();

  // --- Create form state ---
  const [surveys, setSurveys] = useState<Option[]>([]);
  const [selectedSurvey, setSelectedSurvey] = useState<Option | null>(null);
  const [sets, setSets] = useState<Option[]>([]);
  const [selectedSet, setSelectedSet] = useState<Option | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // --- Active shares state ---
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<
    Record<string, Option | null>
  >({});
  const [busyShare, setBusyShare] = useState<string | null>(null);

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
    async (shareId: string) => {
      const user = selectedUser[shareId];
      if (!user) return;
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
    [client, selectedUser, refreshReviewers],
  );

  const onRemoveReviewer = useCallback(
    async (shareId: string) => {
      const user = selectedUser[shareId];
      if (!user) return;
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
    [client, selectedUser, refreshReviewers],
  );

  const onRevoke = useCallback(
    async (shareId: string) => {
      if (
        !window.confirm(
          `Revoke share ${shareId}? This deletes the snapshot data. Reviewer feedback is kept.`,
        )
      ) {
        return;
      }
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

  return (
    <div style={{ width: '100%' }}>
      <Card className='mb-4'>
        <CardHeader>
          <h4 className='mb-0'>Share a chain review</h4>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onCreate();
            }}
          >
            <div className='flex flex-row flex-wrap items-end gap-2'>
              <div style={{ minWidth: 260, flex: 1 }}>
                <Label>Survey</Label>
                <Combobox
                  value={selectedSurvey}
                  onChange={(option) => setSelectedSurvey(option)}
                  options={surveys}
                  placeholder='Select survey…'
                  clearable
                  name='Survey'
                />
              </div>
              <div style={{ minWidth: 260, flex: 1 }}>
                <Label>Annotation set</Label>
                <Combobox
                  value={selectedSet}
                  onChange={(option) => setSelectedSet(option)}
                  options={sets}
                  placeholder={
                    selectedSurvey
                      ? 'Select annotation set…'
                      : 'Pick a survey first'
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
                  'Create share'
                )}
              </Button>
            </div>
          </form>

          {message && <p className='mt-4 mb-0 text-info'>{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex items-center justify-between'>
          <h4 className='mb-0'>Shares and recovery</h4>
          <Button
            variant='outline-light'
            size='sm'
            onClick={() => {
              void loadShares();
              refreshReviewers();
            }}
          >
            <RotateCw size={14} className='mr-1' />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className='p-0'>
          {reviewersFailed && (
            <p className='p-4 text-danger'>
              Could not load reviewer membership. Refresh before revoking a
              share.
            </p>
          )}
          {loading ? (
            <div className='p-4'>
              <Spinner animation='border' size='sm' />
            </div>
          ) : shares.length === 0 ? (
            <p className='mb-0 p-4'>No shares to manage.</p>
          ) : (
            <Table
              responsive
              hover
              size='sm'
              className='chain-share-table mb-0 align-middle'
            >
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Annotation set</th>
                  <th>Status</th>
                  <th>Reviewers</th>
                  <th style={{ width: 360 }}>Manage reviewer</th>
                  <th style={{ width: 100, textAlign: 'end' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => {
                  const assigned = reviewersByShare?.[share.shareId] ?? [];
                  const operationBusy = isShareOperationBusy(share);
                  const recovering = share.status !== 'active';
                  return (
                    <tr key={share.shareId}>
                      <td className='font-semibold'>
                        {share.surveyName ?? '—'}
                      </td>
                      <td>
                        {share.annotationSetName ?? share.annotationSetId}
                      </td>
                      <td>
                        <Badge
                          variant={
                            share.status === 'active' ? 'success' : 'warning'
                          }
                          className='uppercase'
                        >
                          {share.status ?? 'unknown'}
                        </Badge>
                        {share.errorMessage && (
                          <div className='text-sm text-danger'>
                            {share.errorMessage}
                          </div>
                        )}
                        {['creating', 'revoking'].includes(
                          share.status ?? '',
                        ) &&
                          !operationBusy && (
                            <div className='text-sm text-warning'>
                              Operation timed out. Remove reviewers, then clean
                              up.
                            </div>
                          )}
                      </td>
                      <td style={{ minWidth: 160 }}>
                        {assigned.length === 0 ? (
                          <span className='text-muted-foreground italic'>
                            No reviewers
                          </span>
                        ) : (
                          <div className='flex flex-row flex-wrap gap-1'>
                            {assigned.map((u) => (
                              <Badge
                                variant='info'
                                key={u.id}
                                title={u.email ?? u.id}
                              >
                                {userNameById.get(u.id) ?? u.id}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 340 }}>
                        <div className='flex flex-row items-center gap-2'>
                          <div style={{ flex: 1, minWidth: 160 }}>
                            <Combobox
                              value={selectedUser[share.shareId] ?? null}
                              onChange={(option) =>
                                setSelectedUser((prev) => ({
                                  ...prev,
                                  [share.shareId]: option,
                                }))
                              }
                              options={userOptions}
                              placeholder='Select account…'
                              clearable
                              name='Reviewer account'
                            />
                          </div>
                          <Button
                            size='sm'
                            variant='warning'
                            disabled={
                              busyShare === share.shareId ||
                              share.status !== 'active' ||
                              !selectedUser[share.shareId]
                            }
                            onClick={() => void onAddReviewer(share.shareId)}
                          >
                            Add
                          </Button>
                          <Button
                            size='sm'
                            variant='outline-warning'
                            disabled={
                              busyShare === share.shareId ||
                              !selectedUser[share.shareId]
                            }
                            onClick={() => void onRemoveReviewer(share.shareId)}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'end' }}>
                        <span
                          title={
                            assigned.length > 0
                              ? 'Remove all reviewers before revoking this share.'
                              : undefined
                          }
                        >
                          <Button
                            size='sm'
                            variant='danger'
                            disabled={
                              busyShare === share.shareId ||
                              operationBusy ||
                              assigned.length > 0 ||
                              !reviewersLoaded ||
                              reviewersRefreshing
                            }
                            onClick={() => void onRevoke(share.shareId)}
                          >
                            {recovering ? 'Clean up' : 'Revoke'}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
