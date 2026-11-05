import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ExternalLink, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUsers } from '../../apiInterface';
import { useSharedChainData } from '../shared/useSharedChainData';
import { AnnotationCrop } from './AnnotationCrop';
import { SelectSharePrompt } from './ChainShareResults';
import { divergesCategory, divergesObscured } from './shareStats';
import { ownerToUserId, useActiveShares } from './useActiveShares';
import {
  foldFeedbackRows,
  useAllChainReviewFeedback,
} from './useAllChainReviewFeedback';

type Option = { label: string; value: string };

const MAX_ROWS = 500;

interface Divergence {
  owner: string;
  ownerLabel: string;
  relabel?: { from: string; to: string };
  obscured?: { from: boolean; to: boolean };
  comment?: string;
}

/**
 * Disagreement Explorer: lists snapshot annotations where one or more selected
 * reviewers diverge from the baseline (relabel / obscured) or left a comment.
 * Each row shows a crop, the baseline label, the per-reviewer change, and a
 * deep-link into the shared chain viewer focused on that chain.
 */
const KINDS = [
  { key: 'relabel', label: 'Relabels' },
  { key: 'obscured', label: 'Obscured changes' },
  { key: 'comment', label: 'Comments' },
] as const;

export default function DisagreementExplorer({
  shareId,
  onShareChange,
}: {
  shareId: string | undefined;
  onShareChange: (shareId: string | undefined) => void;
}) {
  const { users } = useUsers();
  const { data: shares, isLoading: sharesLoading } = useActiveShares();

  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [kinds, setKinds] = useState({
    relabel: true,
    obscured: true,
    comment: true,
  });
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

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
  const ownerLabel = useCallback(
    (owner: string) =>
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

  useEffect(() => {
    setSelectedOwners(feedback?.owners ?? []);
  }, [feedback?.owners]);

  const annotations = useMemo(() => chainData?.annotations ?? [], [chainData]);
  const categories = useMemo(() => chainData?.categories ?? [], [chainData]);
  const catNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const catColorById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of categories) m.set(c.id, c.color);
    return m;
  }, [categories]);
  const categoryOptions: Option[] = [
    { value: 'all', label: 'All labels' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  // (owner, annotationId) -> comment text
  const commentByOwnerAnn = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of feedbackRows ?? []) {
      if (r.kind === 'comment' && r.comment) {
        m.set(`${r.owner}#${r.sharedAnnotationId}`, r.comment);
      }
    }
    return m;
  }, [feedbackRows]);

  const rows = useMemo(() => {
    if (!chainData) return [];
    const out: Array<{
      annId: string;
      x: number;
      y: number;
      oov: boolean;
      baselineCategoryId: string;
      baselineObscured: boolean;
      chainId: string;
      divergences: Divergence[];
    }> = [];

    for (const ann of annotations) {
      if (categoryFilter !== 'all' && ann.categoryId !== categoryFilter)
        continue;
      const divergences: Divergence[] = [];
      for (const owner of selectedOwners) {
        const overlay = feedback.overlayByOwner.get(owner);
        if (!overlay) continue;
        const div: Divergence = { owner, ownerLabel: ownerLabel(owner) };
        if (kinds.relabel && divergesCategory(ann, overlay)) {
          const to = overlay.category.get(ann.id)!;
          div.relabel = {
            from: catNameById.get(ann.categoryId) ?? ann.categoryId,
            to: catNameById.get(to) ?? to,
          };
        }
        if (kinds.obscured && divergesObscured(ann, overlay)) {
          div.obscured = {
            from: ann.obscured,
            to: overlay.obscured.get(ann.id)!,
          };
        }
        if (kinds.comment) {
          const c = commentByOwnerAnn.get(`${owner}#${ann.id}`);
          if (c) div.comment = c;
        }
        if (div.relabel || div.obscured || div.comment) divergences.push(div);
      }
      if (divergences.length > 0) {
        out.push({
          annId: ann.id,
          x: ann.x,
          y: ann.y,
          oov: ann.oov,
          baselineCategoryId: ann.categoryId,
          baselineObscured: ann.obscured,
          chainId:
            feedback.chainIdByAnnotation.get(ann.id) ?? ann.objectId ?? ann.id,
          divergences,
        });
      }
    }
    return out;
  }, [
    chainData,
    feedback,
    annotations,
    selectedOwners,
    kinds,
    categoryFilter,
    catNameById,
    commentByOwnerAnn,
    ownerLabel,
  ]);

  const busy = chainLoading || feedbackLoading;
  const shown = rows.slice(0, MAX_ROWS);

  const pill = 'rounded-full px-2.5 py-0.5 text-sm';

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
        <div className='min-w-72 flex-1'>
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
        <div className='min-w-48'>
          <Label className='mb-1'>Label</Label>
          <Combobox
            value={
              categoryOptions.find((o) => o.value === categoryFilter) ?? null
            }
            onChange={(option) => setCategoryFilter(option?.value ?? 'all')}
            options={categoryOptions}
            disabled={!shareId}
            name='Label'
          />
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm text-muted-foreground'>Show</span>
        {KINDS.map(({ key, label }) => (
          <button
            key={key}
            type='button'
            aria-pressed={kinds[key]}
            onClick={() => setKinds((prev) => ({ ...prev, [key]: !prev[key] }))}
            className={cn(
              'border px-3 py-1 text-sm transition-colors',
              kinds[key]
                ? 'border-primary bg-primary/20'
                : 'border-white/30 text-muted-foreground hover:bg-white/10',
            )}
          >
            {label}
          </button>
        ))}
        {shareId && !busy && (
          <span className='ml-auto text-sm text-muted-foreground'>
            {rows.length.toLocaleString()} annotation
            {rows.length === 1 ? '' : 's'} with disagreements
            {rows.length > MAX_ROWS && `, showing the first ${MAX_ROWS}`}
          </span>
        )}
      </div>

      {!shareId || busy ? (
        <SelectSharePrompt busy={!!shareId && busy} />
      ) : rows.length === 0 ? (
        <div className='flex flex-col items-center gap-2 border border-dark bg-[#6F7B89] py-10 text-muted-foreground'>
          <SearchX size={28} className='opacity-70' />
          No disagreements match these filters
        </div>
      ) : (
        <div className='flex flex-col border border-dark'>
          {shown.map((row) => (
            <div
              key={row.annId}
              className='flex gap-4 border-b border-dark p-3 last:border-b-0 odd:bg-white/[0.03]'
            >
              <AnnotationCrop
                meta={chainData?.metaByAnnotationId[row.annId]}
                x={row.x}
                y={row.y}
                oov={row.oov}
                markerColor={
                  catColorById.get(row.baselineCategoryId) ?? '#facc15'
                }
              />
              <div className='flex min-w-0 grow flex-col gap-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='text-sm text-muted-foreground'>
                    Baseline
                  </span>
                  <span
                    className={cn(pill, 'text-white')}
                    style={{
                      background:
                        catColorById.get(row.baselineCategoryId) ?? '#888',
                    }}
                  >
                    {catNameById.get(row.baselineCategoryId) ??
                      row.baselineCategoryId}
                  </span>
                  <span className={cn(pill, 'bg-white/15')}>
                    {row.oov
                      ? 'Out of view'
                      : row.baselineObscured
                        ? 'Obscured'
                        : 'Visible'}
                  </span>
                  <Button asChild variant='ghost' className='ml-auto'>
                    <a
                      href={`/shared-chains/${shareId}?chain=${row.chainId}`}
                      target='_blank'
                      rel='noopener noreferrer'
                    >
                      <ExternalLink size={16} />
                      Open in viewer
                    </a>
                  </Button>
                </div>
                <div className='flex flex-col gap-1'>
                  {row.divergences.map((d) => (
                    <div
                      key={d.owner}
                      className='flex flex-wrap items-baseline gap-x-3 text-sm'
                    >
                      <strong>{d.ownerLabel}</strong>
                      {d.relabel && (
                        <span>
                          {d.relabel.from} →{' '}
                          <span className='text-warning'>{d.relabel.to}</span>
                        </span>
                      )}
                      {d.obscured && (
                        <span>
                          {d.obscured.from ? 'Obscured' : 'Visible'} →{' '}
                          <span className='text-warning'>
                            {d.obscured.to ? 'obscured' : 'visible'}
                          </span>
                        </span>
                      )}
                      {d.comment && (
                        <span className='text-muted-foreground italic'>
                          “{d.comment}”
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
