import { useQuery } from '@tanstack/react-query';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';
import { emptyOverlay, type Overlay } from './shareStats';

/** A single reviewer feedback row, in the shape the admin pages consume. */
export interface FeedbackRow {
  id: string;
  owner: string;
  sharedAnnotationId: string;
  chainId: string | null;
  kind: string;
  proposedObscured: boolean | null;
  proposedCategoryId: string | null;
  comment: string | null;
  updatedAt: string | null;
}

export interface FoldedFeedback {
  /** Net overlay per owner, for distribution / diff stats. */
  overlayByOwner: Map<string, Overlay>;
  /** Distinct owners that have any feedback for the share, sorted. */
  owners: string[];
  /** annotation id -> chainId, for deep-linking into the shared viewer. */
  chainIdByAnnotation: Map<string, string>;
}

/**
 * Loads *all* reviewer feedback rows for a share (every owner — sysadmins read
 * the whole table via `chainReviewFeedbackByShareId`). Returns a plain array so
 * the result stays JSON-safe for react-query's localStorage persistence (Maps
 * silently serialize to `{}` — see useSharedChainData). Callers fold rows into
 * Maps with {@link foldFeedbackRows} inside a useMemo. Read-only; never writes.
 */
export function useAllChainReviewFeedback(shareId: string | undefined) {

  return useQuery<FeedbackRow[]>({
    queryKey: ['all-chain-review-feedback', shareId],
    enabled: Boolean(shareId),
    staleTime: 60_000,
    queryFn: async () => {
      const id = shareId!;
      const raw = (await fetchAllPaginatedResults(
        client.models.ChainReviewFeedback.chainReviewFeedbackByShareId,
        {
          shareId: id,
          selectionSet: [
            'id',
            'owner',
            'sharedAnnotationId',
            'chainId',
            'kind',
            'proposedObscured',
            'proposedCategoryId',
            'comment',
            'updatedAt',
          ] as const,
          limit: 10000,
        }
      )) as Array<{
        id: string;
        owner?: string | null;
        sharedAnnotationId: string;
        chainId?: string | null;
        kind: string;
        proposedObscured?: boolean | null;
        proposedCategoryId?: string | null;
        comment?: string | null;
        updatedAt?: string | null;
      }>;

      return raw.map((r) => ({
        id: r.id,
        owner: r.owner ?? 'unknown',
        sharedAnnotationId: r.sharedAnnotationId,
        chainId: r.chainId ?? null,
        kind: r.kind,
        proposedObscured:
          typeof r.proposedObscured === 'boolean' ? r.proposedObscured : null,
        proposedCategoryId: r.proposedCategoryId ?? null,
        comment: r.comment ?? null,
        updatedAt: r.updatedAt ?? null,
      }));
    },
  });
}

/** Fold raw feedback rows into per-owner overlays (call inside a useMemo). */
export function foldFeedbackRows(rows: FeedbackRow[]): FoldedFeedback {
  const overlayByOwner = new Map<string, Overlay>();
  const chainIdByAnnotation = new Map<string, string>();
  for (const r of rows) {
    let overlay = overlayByOwner.get(r.owner);
    if (!overlay) {
      overlay = emptyOverlay();
      overlayByOwner.set(r.owner, overlay);
    }
    if (r.kind === 'relabel' && r.proposedCategoryId) {
      overlay.category.set(r.sharedAnnotationId, r.proposedCategoryId);
    }
    if (r.kind === 'obscured' && typeof r.proposedObscured === 'boolean') {
      overlay.obscured.set(r.sharedAnnotationId, r.proposedObscured);
    }
    if (r.chainId && !chainIdByAnnotation.has(r.sharedAnnotationId)) {
      chainIdByAnnotation.set(r.sharedAnnotationId, r.chainId);
    }
  }
  return {
    overlayByOwner,
    owners: [...overlayByOwner.keys()].sort(),
    chainIdByAnnotation,
  };
}
