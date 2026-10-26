import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { ExternalLink } from 'lucide-react';
import { Combobox } from '@/components/ui/combobox';
import { useUsers } from '../../apiInterface';
import { useSharedChainData } from '../shared/useSharedChainData';
import { useActiveShares, ownerToUserId } from './useActiveShares';
import {
  foldFeedbackRows,
  useAllChainReviewFeedback,
} from './useAllChainReviewFeedback';
import { divergesCategory, divergesObscured } from './shareStats';
import { AnnotationCrop } from './AnnotationCrop';

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
export default function DisagreementExplorer() {
  const { users } = useUsers();
  const { data: shares, isLoading: sharesLoading } = useActiveShares();

  const [shareId, setShareId] = useState<string | undefined>(undefined);
  const [selectedOwners, setSelectedOwners] = useState<string[]>([]);
  const [kinds, setKinds] = useState({ relabel: true, obscured: true, comment: true });
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

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
  const ownerLabel = useCallback(
    (owner: string) =>
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
      if (categoryFilter !== 'all' && ann.categoryId !== categoryFilter) continue;
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

  return (
    <div style={{ width: '100%' }}>
      <Card className='mb-4'>
        <CardHeader>
          <h4 className='mb-0'>Disagreement Explorer</h4>
        </CardHeader>
        <CardContent>
          <div className='flex flex-row flex-wrap gap-4 items-end'>
            <div style={{ minWidth: 280, flex: 1 }}>
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
            <div style={{ minWidth: 280, flex: 1 }}>
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
            <div style={{ minWidth: 180 }}>
              <Label>Label</Label>
              <Combobox
                value={categoryOptions.find((o) => o.value === categoryFilter) ?? null}
                onChange={(option) =>
                  setCategoryFilter(option?.value ?? 'all')
                }
                options={categoryOptions}
                disabled={!shareId}
                name='Label'
              />
            </div>
          </div>
          <div className='flex flex-row gap-4 mt-2'>
            {(['relabel', 'obscured', 'comment'] as const).map((k) => (
              <div key={k} className='flex items-center gap-2'>
                <Checkbox
                  id={`kind-${k}`}
                  checked={kinds[k]}
                  onCheckedChange={(c) =>
                    setKinds((prev) => ({ ...prev, [k]: c === true }))
                  }
                />
                <Label htmlFor={`kind-${k}`} className='mb-0'>
                  {k}
                </Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!shareId ? (
        <p className='text-muted-foreground'>Select a share to explore disagreements.</p>
      ) : busy ? (
        <Spinner animation='border' />
      ) : rows.length === 0 ? (
        <p className='text-muted-foreground'>
          No disagreements match the current filters.
        </p>
      ) : (
        <>
          <p className='text-muted-foreground'>
            {rows.length} annotation{rows.length === 1 ? '' : 's'} with divergences
            {rows.length > MAX_ROWS && ` (showing first ${MAX_ROWS})`}.
          </p>
          <div className='flex flex-col gap-2'>
            {shown.map((row) => (
              <Card key={row.annId}>
                <CardContent className='flex flex-row gap-4'>
                  <AnnotationCrop
                    meta={chainData?.metaByAnnotationId[row.annId]}
                    x={row.x}
                    y={row.y}
                    oov={row.oov}
                    markerColor={catColorById.get(row.baselineCategoryId) ?? '#facc15'}
                  />
                  <div className='grow'>
                    <div className='flex flex-row items-center gap-2 mb-2'>
                      <span>
                        Baseline:{' '}
                        <Badge
                          style={{
                            background:
                              catColorById.get(row.baselineCategoryId) ?? '#888',
                          }}
                        >
                          {catNameById.get(row.baselineCategoryId) ??
                            row.baselineCategoryId}
                        </Badge>
                      </span>
                      {row.oov ? (
                        <Badge variant='secondary'>OOV</Badge>
                      ) : row.baselineObscured ? (
                        <Badge variant='dark'>Obscured</Badge>
                      ) : (
                        <Badge variant='light' className='text-dark'>
                          Visible
                        </Badge>
                      )}
                      <Button
                        asChild
                        size='sm'
                        variant='outline-light'
                        className='ml-auto'
                      >
                        <a
                          href={`/shared-chains/${shareId}?chain=${row.chainId}`}
                          target='_blank'
                          rel='noopener noreferrer'
                        >
                          <ExternalLink size={14} className='mr-1' />
                          Open in viewer
                        </a>
                      </Button>
                    </div>
                    <div className='flex flex-col gap-1'>
                      {row.divergences.map((d) => (
                        <div key={d.owner} className='text-sm'>
                          <strong>{d.ownerLabel}</strong>
                          {d.relabel && (
                            <span className='ml-2'>
                              relabel: {d.relabel.from} →{' '}
                              <span className='text-warning'>{d.relabel.to}</span>
                            </span>
                          )}
                          {d.obscured && (
                            <span className='ml-2'>
                              obscured: {d.obscured.from ? 'yes' : 'no'} →{' '}
                              <span className='text-warning'>
                                {d.obscured.to ? 'yes' : 'no'}
                              </span>
                            </span>
                          )}
                          {d.comment && (
                            <span className='ml-2 italic'>“{d.comment}”</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
