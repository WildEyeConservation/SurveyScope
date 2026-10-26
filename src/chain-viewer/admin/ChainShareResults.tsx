import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Table } from '@/components/ui/table';
import { Combobox } from '@/components/ui/combobox';
import './admin.css';
import { useUsers } from '../../apiInterface';
import { useSharedChainData } from '../shared/useSharedChainData';
import { useActiveShares, ownerToUserId } from './useActiveShares';
import {
  foldFeedbackRows,
  useAllChainReviewFeedback,
} from './useAllChainReviewFeedback';
import {
  computeCombinedOverlay,
  computeDistribution,
  computeObscuredDiff,
  emptyOverlay,
  type Overlay,
} from './shareStats';

type Option = { label: string; value: string };

interface Column {
  key: string;
  label: string;
  overlay: Overlay;
  isBaseline: boolean;
}

/** Signed count delta, coloured green (+) / red (−), blank when zero. */
function Delta({ value }: { value: number }) {
  if (value === 0) return null;
  return (
    <span className={value > 0 ? 'text-success' : 'text-danger'} style={{ marginLeft: 6 }}>
      ({value > 0 ? '+' : ''}
      {value})
    </span>
  );
}

/**
 * Results dashboard: pick a share and reviewers, then compare the baseline
 * snapshot's label distribution and obscured-status against each reviewer's
 * opinions (and a combined consensus). Reviewers only record divergences, so a
 * reviewer with no feedback for an annotation is counted as agreeing.
 */
export default function ChainShareResults() {
  const { users } = useUsers();
  const { data: shares, isLoading: sharesLoading } = useActiveShares();

  const [shareId, setShareId] = useState<string | undefined>(undefined);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);

  const { data: chainData, isLoading: chainLoading } = useSharedChainData(shareId);
  const { data: feedbackRows, isLoading: feedbackLoading } =
    useAllChainReviewFeedback(shareId);
  const feedback = useMemo(
    () => foldFeedbackRows(feedbackRows ?? []),
    [feedbackRows]
  );

  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name ?? u.email ?? u.id);
    return m;
  }, [users]);

  const ownerLabel = useMemo(
    () => (owner: string) =>
      userNameById.get(ownerToUserId(owner)) ?? ownerToUserId(owner),
    [userNameById]
  );

  const shareOptions: Option[] = (shares ?? []).map((s) => ({
    value: s.shareId,
    label: `${s.surveyName ?? '—'} — ${s.annotationSetName ?? s.annotationSetId}`,
  }));

  const ownerOptions: Option[] = (feedback?.owners ?? []).map((o) => ({
    value: o,
    label: ownerLabel(o),
  }));

  // Default the reviewer filter to "all reviewers with feedback" on share change.
  useEffect(() => {
    setSelectedOwners(feedback?.owners ?? []);
  }, [feedback?.owners]);

  const annotations = useMemo(() => chainData?.annotations ?? [], [chainData]);
  const categories = useMemo(() => chainData?.categories ?? [], [chainData]);
  const catById = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const c of categories) m.set(c.id, { name: c.name, color: c.color });
    return m;
  }, [categories]);

  // Build columns: baseline, one per selected reviewer, plus combined (>1).
  const columns: Column[] = useMemo(() => {
    const cols: Column[] = [
      { key: 'baseline', label: 'Baseline', overlay: emptyOverlay(), isBaseline: true },
    ];
    const overlays: Overlay[] = [];
    for (const owner of selectedOwners) {
      const overlay = feedback?.overlayByOwner.get(owner) ?? emptyOverlay();
      overlays.push(overlay);
      cols.push({ key: owner, label: ownerLabel(owner), overlay, isBaseline: false });
    }
    if (overlays.length > 1) {
      cols.push({
        key: 'combined',
        label: 'Combined',
        overlay: computeCombinedOverlay(annotations, overlays),
        isBaseline: false,
      });
    }
    return cols;
  }, [annotations, feedback, selectedOwners, ownerLabel]);

  const perColumn = useMemo(
    () =>
      columns.map((col) => ({
        col,
        dist: computeDistribution(annotations, col.overlay),
        obscured: computeObscuredDiff(annotations, col.overlay),
      })),
    [columns, annotations]
  );

  const baselineDist = perColumn[0]?.dist;

  // Categories with at least one annotation in any column.
  const visibleCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { dist } of perColumn) {
      for (const [id, count] of dist.byCategory) if (count > 0) ids.add(id);
    }
    return [...ids].sort(
      (a, b) =>
        (baselineDist?.byCategory.get(b) ?? 0) - (baselineDist?.byCategory.get(a) ?? 0)
    );
  }, [perColumn, baselineDist]);

  const busy = chainLoading || feedbackLoading;

  return (
    <div style={{ width: '100%' }}>
      <Card className='mb-4'>
        <CardHeader>
          <h4 className='mb-0'>Results</h4>
        </CardHeader>
        <CardContent>
          <div className='flex flex-row flex-wrap gap-4 items-end'>
            <div style={{ minWidth: 320, flex: 1 }}>
              <Label>Share</Label>
              <Combobox
                value={shareOptions.find((o) => o.value === shareId) ?? null}
                onChange={(option) => setShareId(option?.value)}
                options={shareOptions}
                placeholder={sharesLoading ? 'Loading shares…' : 'Select a share…'}
                loading={sharesLoading}
                clearable
                name='Share'
              />
            </div>
            <div style={{ minWidth: 320, flex: 2 }}>
              <Label>Reviewers</Label>
              <Combobox
                multiple
                value={ownerOptions.filter((o) => selectedOwners.includes(o.value))}
                onChange={(options) => setSelectedOwners(options.map((o) => o.value))}
                options={ownerOptions}
                placeholder='All reviewers'
                disabled={!shareId || ownerOptions.length === 0}
                name='Reviewers'
              />
            </div>
          </div>
          {shareId && !busy && (feedback?.owners.length ?? 0) === 0 && (
            <p className='mt-4 mb-0 text-warning'>
              No reviewer feedback recorded for this share yet — showing baseline only.
            </p>
          )}
        </CardContent>
      </Card>

      {!shareId ? (
        <p className='text-muted-foreground'>Select a share to see results.</p>
      ) : busy ? (
        <Spinner animation='border' />
      ) : (
        <>
          <Card className='mb-4'>
            <CardHeader>
              <h5 className='mb-0'>Label distribution</h5>
              <small className='text-muted-foreground'>
                Effective count per reviewer with delta vs baseline. Combined =
                plurality consensus (ties fall back to baseline).
              </small>
            </CardHeader>
            <CardContent className='p-0'>
              <Table
                responsive
                hover
                size='sm'
                className='align-middle mb-0 chain-share-table'
              >
                <thead>
                  <tr>
                    <th>Label</th>
                    {perColumn.map(({ col }) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleCategoryIds.map((id) => {
                    const cat = catById.get(id);
                    const baseCount = baselineDist?.byCategory.get(id) ?? 0;
                    return (
                      <tr key={id}>
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              marginRight: 6,
                              background: cat?.color ?? '#888',
                            }}
                          />
                          {cat?.name ?? id}
                        </td>
                        {perColumn.map(({ col, dist }) => {
                          const count = dist.byCategory.get(id) ?? 0;
                          return (
                            <td key={col.key}>
                              {count}
                              {!col.isBaseline && <Delta value={count - baseCount} />}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <td>
                      <strong>Total annotations</strong>
                    </td>
                    {perColumn.map(({ col, dist }) => (
                      <td key={col.key}>{dist.total}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Out of view</td>
                    {perColumn.map(({ col, dist }) => (
                      <td key={col.key}>{dist.oov}</td>
                    ))}
                  </tr>
                </tbody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h5 className='mb-0'>Obscured status</h5>
              <small className='text-muted-foreground'>
                Out-of-view rows excluded (their obscured flag is not editable).
              </small>
            </CardHeader>
            <CardContent className='p-0'>
              <Table
                responsive
                hover
                size='sm'
                className='align-middle mb-0 chain-share-table'
              >
                <thead>
                  <tr>
                    <th>Metric</th>
                    {perColumn.map(({ col }) => (
                      <th key={col.key}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Obscured count</td>
                    {perColumn.map(({ col, dist }) => (
                      <td key={col.key}>
                        {dist.obscuredCount}
                        {!col.isBaseline && (
                          <Delta
                            value={
                              dist.obscuredCount -
                              (baselineDist?.obscuredCount ?? 0)
                            }
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td>Marked obscured (was visible)</td>
                    {perColumn.map(({ col, obscured }) => (
                      <td key={col.key}>{col.isBaseline ? '—' : obscured.added}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Marked visible (was obscured)</td>
                    {perColumn.map(({ col, obscured }) => (
                      <td key={col.key}>{col.isBaseline ? '—' : obscured.removed}</td>
                    ))}
                  </tr>
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
