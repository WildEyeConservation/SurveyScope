import DataTable, { type DataColumn } from '@/components/DataTable';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { BarChart3 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useUsers } from '../../apiInterface';
import { useSharedChainData } from '../shared/useSharedChainData';
import {
  computeCombinedOverlay,
  computeDistribution,
  computeObscuredDiff,
  emptyOverlay,
  type Overlay,
} from './shareStats';
import { ownerToUserId, useActiveShares } from './useActiveShares';
import {
  foldFeedbackRows,
  useAllChainReviewFeedback,
} from './useAllChainReviewFeedback';

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
    <span className={cn('ml-1.5', value > 0 ? 'text-success' : 'text-danger')}>
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
export function SelectSharePrompt({ busy }: { busy: boolean }) {
  return (
    <div className='flex flex-col items-center gap-2 border border-dark bg-[#6F7B89] py-10 text-muted-foreground'>
      {busy ? (
        <Spinner animation='border' />
      ) : (
        <>
          <BarChart3 size={28} className='opacity-70' />
          Select a share above
        </>
      )}
    </div>
  );
}

type TableRow = { id: string; cells: ReactNode[] };

function MetricTable(props: {
  head: string[];
  rows: TableRow[];
  footer?: ReactNode[];
}) {
  const columns: DataColumn<TableRow>[] = props.head.map((title, index) => ({
    id: String(index),
    header: title,
    enableSorting: false,
    cell: ({ row }) => row.original.cells[index],
    meta: {
      className:
        index === 0 ? undefined : 'text-right tabular-nums whitespace-nowrap',
    },
  }));
  return (
    <DataTable
      storageKey='chain-share-results'
      columns={columns}
      data={props.rows}
      getRowId={(row) => row.id}
      pageSize={false}
      footer={props.footer}
    />
  );
}

export default function ChainShareResults({
  shareId,
  onShareChange,
}: {
  shareId: string | undefined;
  onShareChange: (shareId: string | undefined) => void;
}) {
  const { users } = useUsers();
  const { data: shares, isLoading: sharesLoading } = useActiveShares();

  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);

  const { data: chainData, isLoading: chainLoading } =
    useSharedChainData(shareId);
  const { data: feedbackRows, isLoading: feedbackLoading } =
    useAllChainReviewFeedback(shareId);
  const feedback = useMemo(
    () => foldFeedbackRows(feedbackRows ?? []),
    [feedbackRows],
  );

  const userNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.name ?? u.email ?? u.id);
    return m;
  }, [users]);

  const ownerLabel = useMemo(
    () => (owner: string) =>
      userNameById.get(ownerToUserId(owner)) ?? ownerToUserId(owner),
    [userNameById],
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
      {
        key: 'baseline',
        label: 'Baseline',
        overlay: emptyOverlay(),
        isBaseline: true,
      },
    ];
    const overlays: Overlay[] = [];
    for (const owner of selectedOwners) {
      const overlay = feedback?.overlayByOwner.get(owner) ?? emptyOverlay();
      overlays.push(overlay);
      cols.push({
        key: owner,
        label: ownerLabel(owner),
        overlay,
        isBaseline: false,
      });
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
    [columns, annotations],
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
        (baselineDist?.byCategory.get(b) ?? 0) -
        (baselineDist?.byCategory.get(a) ?? 0),
    );
  }, [perColumn, baselineDist]);

  const busy = chainLoading || feedbackLoading;
  const head = ['', ...perColumn.map(({ col }) => col.label)];

  const distributionRows: TableRow[] = visibleCategoryIds.map((id) => {
    const cat = catById.get(id);
    const baseCount = baselineDist?.byCategory.get(id) ?? 0;
    return {
      id,
      cells: [
        <span className='flex items-center gap-2'>
          <span
            className='inline-block size-2.5 shrink-0 rounded-sm'
            style={{ background: cat?.color ?? '#888' }}
          />
          {cat?.name ?? id}
        </span>,
        ...perColumn.map(({ col, dist }) => {
          const count = dist.byCategory.get(id) ?? 0;
          return (
            <>
              {count.toLocaleString()}
              {!col.isBaseline && <Delta value={count - baseCount} />}
            </>
          );
        }),
      ],
    };
  });

  const statusRows: TableRow[] = [
    {
      id: 'oov',
      cells: [
        'Out of view',
        ...perColumn.map(({ dist }) => dist.oov.toLocaleString()),
      ],
    },
    {
      id: 'obscured',
      cells: [
        'Obscured',
        ...perColumn.map(({ col, dist }) => (
          <>
            {dist.obscuredCount.toLocaleString()}
            {!col.isBaseline && (
              <Delta
                value={dist.obscuredCount - (baselineDist?.obscuredCount ?? 0)}
              />
            )}
          </>
        )),
      ],
    },
    {
      id: 'added',
      cells: [
        'Marked obscured (was visible)',
        ...perColumn.map(({ col, obscured }) =>
          col.isBaseline ? '—' : obscured.added.toLocaleString(),
        ),
      ],
    },
    {
      id: 'removed',
      cells: [
        'Marked visible (was obscured)',
        ...perColumn.map(({ col, obscured }) =>
          col.isBaseline ? '—' : obscured.removed.toLocaleString(),
        ),
      ],
    },
  ];

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-end gap-2'>
        <div className='min-w-72 flex-1'>
          <Label className='mb-1'>Share</Label>
          <Combobox
            value={shareOptions.find((o) => o.value === shareId) ?? null}
            onChange={(option) => onShareChange(option?.value)}
            options={shareOptions}
            placeholder={sharesLoading ? 'Loading shares…' : 'Select a share…'}
            loading={sharesLoading}
            clearable
            name='Share'
          />
        </div>
        <div className='min-w-72 flex-[2]'>
          <Label className='mb-1'>Reviewers</Label>
          <Combobox
            multiple
            value={ownerOptions.filter((o) => selectedOwners.includes(o.value))}
            onChange={(options) =>
              setSelectedOwners(options.map((o) => o.value))
            }
            options={ownerOptions}
            placeholder='All reviewers'
            disabled={!shareId || ownerOptions.length === 0}
            name='Reviewers'
          />
        </div>
      </div>

      {!shareId || busy ? (
        <SelectSharePrompt busy={!!shareId && busy} />
      ) : (
        <>
          {(feedback?.owners.length ?? 0) === 0 && (
            <Alert variant='warning' className='mb-0'>
              No reviewer feedback recorded for this share yet, so only the
              baseline is shown.
            </Alert>
          )}
          <Card>
            <CardHeader className='py-3'>
              <div className='font-semibold'>Label distribution</div>
              <div className='text-sm text-muted-foreground'>
                Count per reviewer with the change from the baseline. Combined
                is the plurality consensus; ties fall back to the baseline.
              </div>
            </CardHeader>
            <CardContent>
              <MetricTable
                head={['Label', ...head.slice(1)]}
                rows={distributionRows}
                footer={[
                  'Total annotations',
                  ...perColumn.map(({ dist }) => dist.total.toLocaleString()),
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className='py-3'>
              <div className='font-semibold'>Visibility</div>
              <div className='text-sm text-muted-foreground'>
                Obscured counts leave out out-of-view annotations, whose
                obscured flag can't be edited.
              </div>
            </CardHeader>
            <CardContent>
              <MetricTable head={head} rows={statusRows} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
