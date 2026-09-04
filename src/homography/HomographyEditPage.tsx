import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Matrix } from 'mathjs';
import { inv, matrix } from 'mathjs';
import { client } from '../stores/appClient';
import type { ImageType } from '../schemaTypes';
import { array2Matrix, makeTransform } from '../utils';
import { HomographyWorkbench } from './HomographyWorkbench';
import { type Point } from './ManualHomographyEditor';
import {
  resolveNeighbourDirection,
  flatToPoints,
  countSuggestedPointsKept,
} from './HomographyWorkbenchWorker';

// Standalone, query-param driven editor for a single neighbour pair's
// homography. Unlike HomographyTask/HomographyWorkbenchWorker, this is not
// queue-driven — it loads the Image records and ImageNeighbour row directly,
// then writes the updated homography back to the same row. Used to fix a bad
// homography spotted from the Individual-ID workflow.
//
// Required query params: image1Id, image2Id
// Optional: annotationSetId (used by the workbench's pre-tile lookup),
//           backHref (URL to navigate to on Cancel / after save).
export default function HomographyEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const image1Id = searchParams.get('image1Id') ?? undefined;
  const image2Id = searchParams.get('image2Id') ?? undefined;
  const annotationSetId = searchParams.get('annotationSetId') ?? undefined;
  const backHref = searchParams.get('backHref') ?? undefined;

  const [images, setImages] = useState<[ImageType, ImageType] | null>(null);
  const [imagesError, setImagesError] = useState<string | null>(null);

  const [initialPoints, setInitialPoints] = useState<
    { p1: Point[]; p2: Point[] } | undefined
  >(undefined);
  const [pointsLoaded, setPointsLoaded] = useState(false);
  const suggestedTotalRef = useRef(0);
  const [savedTransforms, setSavedTransforms] = useState<
    | [
        (c: [number, number]) => [number, number],
        (c: [number, number]) => [number, number],
      ]
    | null
  >(null);
  const currentPointsRef = useRef<{ p1: Point[]; p2: Point[] }>({
    p1: [],
    p2: [],
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Load both Image records in parallel.
  useEffect(() => {
    if (!image1Id || !image2Id) return;
    let cancelled = false;
    setImagesError(null);
    Promise.all([
      client.models.Image.get({ id: image1Id }),
      client.models.Image.get({ id: image2Id }),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        if (!a?.data || !b?.data) {
          setImagesError(
            `Could not load one or both images (${image1Id}, ${image2Id}).`
          );
          return;
        }
        setImages([a.data as ImageType, b.data as ImageType]);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load images for homography edit', err);
        setImagesError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [image1Id, image2Id]);

  // Load the existing ImageNeighbour's suggestedPoints as starting state.
  // Mirrors HomographyWorkbenchWorker — the saved homography matrix itself
  // doesn't preserve the points used, so re-editing starts from the original
  // lightglue suggestions (if any).
  useEffect(() => {
    if (!image1Id || !image2Id) return;
    let cancelled = false;
    setInitialPoints(undefined);
    setPointsLoaded(false);
    setSavedTransforms(null);
    suggestedTotalRef.current = 0;
    (async () => {
      try {
        const dir = await resolveNeighbourDirection(client, image1Id, image2Id);
        if (cancelled) return;
        const p1 = flatToPoints(
          dir.isForward ? dir.suggestedPoints1 : dir.suggestedPoints2
        );
        const p2 = flatToPoints(
          dir.isForward ? dir.suggestedPoints2 : dir.suggestedPoints1
        );
        const n = Math.min(p1.length, p2.length);
        if (n > 0) {
          suggestedTotalRef.current = n;
          setInitialPoints({ p1: p1.slice(0, n), p2: p2.slice(0, n) });
        }

        // Derive the saved-homography transforms for the red reference
        // overlay. `dir.homography` is stored in the canonical direction
        // image1→image2; we orient to [primary→secondary, secondary→primary]
        // to match what the workbench expects for `images=[primary, secondary]`.
        const arr = array2Matrix(
          (dir.homography as number[] | null | undefined) ?? null
        );
        if (arr) {
          try {
            const M = matrix(arr) as Matrix;
            const Minv = inv(M) as Matrix;
            const forwardForDir = makeTransform(M);
            const backwardForDir = makeTransform(Minv);
            const savedFwd = dir.isForward ? forwardForDir : backwardForDir;
            const savedBwd = dir.isForward ? backwardForDir : forwardForDir;
            if (!cancelled) setSavedTransforms([savedFwd, savedBwd]);
          } catch (err) {
            console.warn('Failed to build saved homography transforms', err);
          }
        }
      } catch (err) {
        console.warn('Failed to load saved homography metadata', err);
      } finally {
        if (!cancelled) setPointsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image1Id, image2Id]);

  const handlePointsChange = useCallback(
    (points: { p1: Point[]; p2: Point[] }) => {
      currentPointsRef.current = points;
      // Any edit invalidates the "Saved" indicator.
      if (isSaved) setIsSaved(false);
    },
    [isSaved]
  );

  const goBack = useCallback(() => {
    if (backHref) {
      navigate(backHref);
    } else {
      navigate(-1);
    }
  }, [backHref, navigate]);

  const handleSave = useCallback(
    async (H: Matrix) => {
      if (!image1Id || !image2Id) return;
      setIsSaving(true);
      let savedOk = false;
      try {
        const flat: number[] = (H.toArray() as number[][]).flat();
        const flatInverse: number[] = (inv(H).toArray() as number[][]).flat();

        const dir = await resolveNeighbourDirection(
          client,
          image1Id,
          image2Id
        );

        const kept =
          suggestedTotalRef.current > 0
            ? countSuggestedPointsKept(currentPointsRef.current)
            : undefined;

        await (client.models.ImageNeighbour.update as any)({
          image1Id: dir.image1Id,
          image2Id: dir.image2Id,
          homography: dir.isForward ? flat : flatInverse,
          homographySource: 'manual',
          ...(kept !== undefined ? { suggestedPointsKept: kept } : {}),
        });

        // The Individual-ID hooks cache pair / transect data with
        // staleTime: Infinity (and persist to localStorage), so going back
        // would otherwise show the OLD homography until the user manually
        // clears the cache. Invalidate any query that could contain a
        // neighbour row for these two images.
        queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey;
            if (!Array.isArray(k)) return false;
            // Single-pair queries: key includes the two image ids.
            if (
              k[0] === 'individual-id-pair' &&
              (k.includes(image1Id) || k.includes(image2Id))
            ) {
              return true;
            }
            // Transect queries don't list image ids in the key — we don't
            // know which transect contains this pair, so invalidate them
            // all. Cheap: there's usually only one in-cache at a time.
            if (k[0] === 'individual-id-transect') return true;
            return false;
          },
        });

        setIsSaved(true);
        savedOk = true;
      } catch (error) {
        console.error('Failed to save homography', error);
      } finally {
        setIsSaving(false);
      }
      // Save = "save and return". On failure we stay on the page so the user
      // can retry or fall back to Cancel.
      if (savedOk) goBack();
    },
    [image1Id, image2Id, queryClient, goBack]
  );

  if (!image1Id || !image2Id) {
    return (
      <div className='p-4 text-light'>
        Missing one of <code>image1Id</code> or <code>image2Id</code> in the
        URL.
      </div>
    );
  }
  if (imagesError) {
    return <div className='p-4 text-light'>{imagesError}</div>;
  }
  if (!images || !pointsLoaded) {
    return (
      <div className='d-flex justify-content-center align-items-center h-100'>
        <div className='text-muted'>Loading homography editor...</div>
      </div>
    );
  }

  return (
    <div
      className='d-flex flex-column align-items-center w-100 h-100'
      style={{ paddingTop: '12px', paddingBottom: '12px' }}
    >
      <div className='w-100 h-100'>
        <HomographyWorkbench
          images={images}
          onSave={handleSave}
          isSaving={isSaving}
          annotationSetId={annotationSetId}
          initialPoints={initialPoints}
          onPointsChange={handlePointsChange}
          isSaved={isSaved}
          savedTransforms={savedTransforms}
          headerRight={
            <button
              className='btn btn-sm btn-outline-secondary'
              onClick={goBack}
              disabled={isSaving}
            >
              Cancel
            </button>
          }
        />
      </div>
    </div>
  );
}
