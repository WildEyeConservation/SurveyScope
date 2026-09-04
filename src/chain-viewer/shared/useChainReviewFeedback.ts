import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../session';
import { client } from '../../stores/appClient';
import { fetchAllPaginatedResults } from '../../utils';

export type FeedbackKind = 'obscured' | 'relabel' | 'comment';

/** A reviewer's net opinion on one snapshot annotation, overlaid for display. */
export interface FeedbackOverlay {
  obscured?: boolean;
  categoryId?: string;
  comment?: string;
}

type FeedbackRow = {
  id: string;
  sharedAnnotationId: string;
  kind: string;
  proposedObscured?: boolean | null;
  proposedCategoryId?: string | null;
  comment?: string | null;
};

function isConditionalCheckError(
  errors: ReadonlyArray<{ message?: string; errorType?: string }>
): boolean {
  return errors.some(
    (e) =>
      e.errorType === 'DynamoDB:ConditionalCheckFailedException' ||
      /conditional (request|check)/i.test(e.message ?? '')
  );
}

/**
 * Loads the signed-in reviewer's own feedback for a share and exposes upserts.
 * Row ids are scoped by share and reviewer to keep reshares separate.
 */
export function useChainReviewFeedback(shareId: string | undefined) {
  const { user } = useSession();
  const userSub = user?.userId ?? 'anon';

  // Net overlay per snapshot annotation id, plus which row ids already exist.
  const [overlay, setOverlay] = useState<Map<string, FeedbackOverlay>>(
    () => new Map()
  );
  const [existingIds, setExistingIds] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const rows = (await fetchAllPaginatedResults(
        client.models.ChainReviewFeedback.chainReviewFeedbackByShareId,
        {
          shareId,
          selectionSet: [
            'id',
            'sharedAnnotationId',
            'kind',
            'proposedObscured',
            'proposedCategoryId',
            'comment',
          ] as const,
          limit: 10000,
        }
      )) as FeedbackRow[];
      if (cancelled) return;
      const nextOverlay = new Map<string, FeedbackOverlay>();
      const ids = new Set<string>();
      for (const r of rows) {
        ids.add(r.id);
        const cur = nextOverlay.get(r.sharedAnnotationId) ?? {};
        if (r.kind === 'obscured' && typeof r.proposedObscured === 'boolean') {
          cur.obscured = r.proposedObscured;
        }
        if (r.kind === 'relabel' && r.proposedCategoryId) {
          cur.categoryId = r.proposedCategoryId;
        }
        if (r.kind === 'comment' && typeof r.comment === 'string') {
          cur.comment = r.comment;
        }
        nextOverlay.set(r.sharedAnnotationId, cur);
      }
      setOverlay(nextOverlay);
      setExistingIds(ids);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [shareId, userSub]);

  const rowId = useCallback(
    (sharedAnnotationId: string, kind: FeedbackKind) =>
      `${shareId}#${userSub}#${sharedAnnotationId}#${kind}`,
    [shareId, userSub]
  );

  const persist = useCallback(
    async (
      sharedAnnotationId: string,
      chainId: string | null,
      kind: FeedbackKind,
      fields: {
        proposedObscured?: boolean;
        proposedCategoryId?: string;
        comment?: string;
      }
    ) => {
      if (!shareId) return;
      const id = rowId(sharedAnnotationId, kind);
      const input = {
        id,
        shareId,
        sharedAnnotationId,
        chainId,
        kind,
        ...fields,
      };
      const runOp = (asUpdate: boolean) =>
        (asUpdate
          ? client.models.ChainReviewFeedback.update
          : client.models.ChainReviewFeedback.create)(input);

      let asUpdate = existingIds.has(id);
      let res = await runOp(asUpdate);
      if (res?.errors?.length && isConditionalCheckError(res.errors)) {
        asUpdate = !asUpdate;
        res = await runOp(asUpdate);
      }
      if (res?.errors?.length) {
        throw new Error(
          res.errors.map((e: { message: string }) => e.message).join('; ')
        );
      }
      setExistingIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    },
    [existingIds, rowId, shareId]
  );

  /** Record the reviewer's obscured opinion for one annotation. */
  const setObscured = useCallback(
    async (
      sharedAnnotationId: string,
      chainId: string | null,
      proposedObscured: boolean
    ) => {
      setOverlay((prev) => {
        const next = new Map(prev);
        next.set(sharedAnnotationId, {
          ...(next.get(sharedAnnotationId) ?? {}),
          obscured: proposedObscured,
        });
        return next;
      });
      await persist(sharedAnnotationId, chainId, 'obscured', {
        proposedObscured,
      });
    },
    [persist]
  );

  /** Record the reviewer's label opinion for one annotation. */
  const setRelabel = useCallback(
    async (
      sharedAnnotationId: string,
      chainId: string | null,
      proposedCategoryId: string
    ) => {
      setOverlay((prev) => {
        const next = new Map(prev);
        next.set(sharedAnnotationId, {
          ...(next.get(sharedAnnotationId) ?? {}),
          categoryId: proposedCategoryId,
        });
        return next;
      });
      await persist(sharedAnnotationId, chainId, 'relabel', {
        proposedCategoryId,
      });
    },
    [persist]
  );

  /** Record (or update) the reviewer's free-text comment for one annotation. */
  const setComment = useCallback(
    async (
      sharedAnnotationId: string,
      chainId: string | null,
      comment: string
    ) => {
      setOverlay((prev) => {
        const next = new Map(prev);
        next.set(sharedAnnotationId, {
          ...(next.get(sharedAnnotationId) ?? {}),
          comment,
        });
        return next;
      });
      await persist(sharedAnnotationId, chainId, 'comment', { comment });
    },
    [persist]
  );

  return { overlay, loaded, setObscured, setRelabel, setComment };
}
