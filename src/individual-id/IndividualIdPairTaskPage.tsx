import { useMemo } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { IndividualIdPairHarness } from './IndividualIdPairHarness';

/**
 * Route parent for the single-pair Individual ID workflow.
 *
 * Reads everything from the URL so the page can be linked, bookmarked, or
 * shared. The "previous" and "next" buttons in the toolbar navigate to URLs
 * the caller supplies via `prevHref` / `nextHref` rather than walking an
 * internal pair list — leaves the chaining/ordering decision to whoever
 * constructed the link.
 *
 * Required query params: image1Id, image2Id, categoryId, annotationSetId.
 * Optional: prevHref, nextHref.
 */
export function IndividualIdPairTaskPage() {
  const [searchParams] = useSearchParams();
  const { surveyId } = useParams();
  const { pathname, search } = useLocation();

  const image1Id = searchParams.get('image1Id') ?? undefined;
  const image2Id = searchParams.get('image2Id') ?? undefined;
  const categoryId = searchParams.get('categoryId') ?? undefined;
  const annotationSetId = searchParams.get('annotationSetId') ?? undefined;
  const prevHref = searchParams.get('prevHref') ?? undefined;
  const nextHref = searchParams.get('nextHref') ?? undefined;

  // The shareable link is the page's own URL minus the prev/next decorations
  // — those describe the journey through pairs, not the pair itself, and
  // shouldn't follow when someone forwards the link.
  const shareHref = useMemo(() => {
    const params = new URLSearchParams(search);
    params.delete('prevHref');
    params.delete('nextHref');
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, search]);

  // Link to the standalone homography editor for this pair. No backHref —
  // the editor falls back to navigate(-1), which keeps the original URL
  // (with prevHref/nextHref intact) rather than the stripped share URL.
  const editHomographyHref = useMemo(() => {
    if (!surveyId || !image1Id || !image2Id) return undefined;
    const params = new URLSearchParams({ image1Id, image2Id });
    if (annotationSetId) params.set('annotationSetId', annotationSetId);
    return `/surveys/${surveyId}/homography-edit?${params.toString()}`;
  }, [surveyId, image1Id, image2Id, annotationSetId]);

  if (!image1Id || !image2Id || !categoryId || !annotationSetId) {
    return (
      <div className='p-6 text-light'>
        Missing one of <code>image1Id</code>, <code>image2Id</code>,{' '}
        <code>categoryId</code>, or <code>annotationSetId</code> in the URL.
      </div>
    );
  }
  if (!surveyId) {
    return <div className='p-6 text-light'>Missing surveyId in the URL.</div>;
  }

  return (
    <IndividualIdPairHarness
      image1Id={image1Id}
      image2Id={image2Id}
      categoryId={categoryId}
      annotationSetId={annotationSetId}
      prevHref={prevHref}
      nextHref={nextHref}
      shareHref={shareHref}
      editHomographyHref={editHomographyHref}
    />
  );
}
