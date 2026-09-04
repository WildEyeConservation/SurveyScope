import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../session';
import { client } from '../stores/appClient';
import { IndividualIdHarness } from '../individual-id';

/**
 * Route element for `/surveys/:surveyId/set/:annotationSetId/chain-review/:primaryId`.
 *
 * Reuses the ChainLinker workflow (Munkres pair matching, accept/skip,
 * reunion search) but scoped to a single chain's image neighbourhood
 * rather than a whole transect. The chain's category is resolved on
 * mount by fetching the chain's primary annotation; the harness then
 * takes over via `chainObjectId`.
 *
 * Gated to sysadmins (chain viewer is too).
 */
export function ChainReviewTaskPage() {
  const { annotationSetId, primaryId } = useParams();
  const { cognitoGroups } = useSession();
  const isSysadmin = cognitoGroups.includes('sysadmin');

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the chain's category from its primary annotation. We try the
  // primary row first (objectId === id), falling back to any annotation in
  // the chain — they should all share a category but the primary is the
  // canonical owner.
  useEffect(() => {
    if (!primaryId || !annotationSetId) return;
    let cancelled = false;
    setError(null);
    setCategoryId(null);

    (async () => {
      try {
        const primaryResp = await (client.models.Annotation.get as any)(
          { id: primaryId },
          { selectionSet: ['id', 'categoryId', 'setId', 'objectId'] }
        );
        const primary = primaryResp?.data;
        if (primary && primary.setId === annotationSetId) {
          if (!cancelled) setCategoryId(primary.categoryId);
          return;
        }

        // Fallback: pick any annotation in the chain that belongs to the set.
        const chainResp = await (
          client.models.Annotation as any
        ).annotationsByObjectId(
          { objectId: primaryId },
          {
            filter: { setId: { eq: annotationSetId } },
            selectionSet: ['categoryId'],
            limit: 1,
          }
        );
        const fallback = (chainResp?.data ?? [])[0];
        if (fallback?.categoryId) {
          if (!cancelled) setCategoryId(fallback.categoryId);
          return;
        }
        if (!cancelled)
          setError(`Chain ${primaryId} not found in this annotation set.`);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to resolve chain category', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [primaryId, annotationSetId]);

  if (!annotationSetId || !primaryId) {
    return (
      <div className='p-4 text-light'>
        Missing <code>annotationSetId</code> or <code>primaryId</code> in the URL.
      </div>
    );
  }
  if (!isSysadmin) {
    return (
      <div className='p-4 text-light'>
        Chain review is restricted to sysadmins.
      </div>
    );
  }
  if (error) {
    return <div className='p-4 text-light'>{error}</div>;
  }
  if (!categoryId) {
    return <div className='p-4 text-light'>Resolving chain…</div>;
  }

  return (
    <IndividualIdHarness
      chainObjectId={primaryId}
      categoryId={categoryId}
      annotationSetId={annotationSetId}
    />
  );
}
