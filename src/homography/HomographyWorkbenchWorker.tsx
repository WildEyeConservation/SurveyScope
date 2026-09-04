import { useState, useCallback, useRef, useEffect } from 'react';
import { client } from '../stores/appClient';
import { HomographyWorkbench } from './HomographyWorkbench';
import type { Matrix } from 'mathjs';
import { inv } from 'mathjs';
import {
  type Point,
  MIN_HOMOGRAPHY_POINTS,
  solveHomography,
} from './ManualHomographyEditor';

export const SUGGESTED_POINT_ID_PREFIX = 'suggested-';

export function flatToPoints(flat: (number | null | undefined)[] | null | undefined): Point[] {
  if (!flat || flat.length < 2) return [];
  const out: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = flat[i];
    const y = flat[i + 1];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    out.push({ id: `${SUGGESTED_POINT_ID_PREFIX}${i / 2}`, x, y });
  }
  return out;
}

export function countSuggestedPointsKept(points: { p1: Point[]; p2: Point[] }): number {
  const n = Math.min(points.p1.length, points.p2.length);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const a = points.p1[i];
    const b = points.p2[i];
    if (
      a.id.startsWith(SUGGESTED_POINT_ID_PREFIX) &&
      b.id.startsWith(SUGGESTED_POINT_ID_PREFIX) &&
      a.id === b.id
    ) {
      kept += 1;
    }
  }
  return kept;
}

export type HomographyImageMeta = {
  id: string;
  width: number;
  height: number;
  timestamp: number | null;
  originalPath: string | null;
  projectId: string;
  latitude: number | null;
  longitude: number | null;
  altitude_wgs84: number | null;
  cameraSerial: string | null;
  group: string | null;
};

export type HomographyMessage = {
  pairKey: string;
  queueId: string;
  annotationSetId: string;
  primaryImage: HomographyImageMeta;
  secondaryImage: HomographyImageMeta;
  ack: () => Promise<void>;
};

type Props = {
  pair: HomographyMessage;
  savedPoints?: { p1: Point[]; p2: Point[] };
  queueId: string;
  onComplete: (pairKey: string) => void;
  onBack?: () => void;
  onForward?: () => void;
  onExit?: () => void;
  onSavePoints: (pairKey: string, points: { p1: Point[]; p2: Point[] }) => void;
  header?: React.ReactNode;
  isSaved?: boolean;
};

export type NeighbourRecord = {
  image1Id: string;
  image2Id: string;
  isForward: boolean;
  suggestedPoints1: (number | null | undefined)[] | null | undefined;
  suggestedPoints2: (number | null | undefined)[] | null | undefined;
  /** Stored 3x3 homography in row-major order, image1→image2. */
  homography: (number | null | undefined)[] | null | undefined;
};

export async function resolveNeighbourDirection(
  client: any,
  primaryId: string,
  secondaryId: string
): Promise<NeighbourRecord> {
  const fwdResp = await client.models.ImageNeighbour.get({
    image1Id: primaryId,
    image2Id: secondaryId,
  });
  if (fwdResp?.data) {
    return {
      image1Id: primaryId,
      image2Id: secondaryId,
      isForward: true,
      suggestedPoints1: fwdResp.data.suggestedPoints1,
      suggestedPoints2: fwdResp.data.suggestedPoints2,
      homography: fwdResp.data.homography,
    };
  }
  const revResp = await client.models.ImageNeighbour.get({
    image1Id: secondaryId,
    image2Id: primaryId,
  });
  if (revResp?.data) {
    return {
      image1Id: secondaryId,
      image2Id: primaryId,
      isForward: false,
      suggestedPoints1: revResp.data.suggestedPoints1,
      suggestedPoints2: revResp.data.suggestedPoints2,
      homography: revResp.data.homography,
    };
  }
  throw new Error(
    `ImageNeighbour record not found in either direction for ${primaryId} / ${secondaryId}`
  );
}

export function HomographyWorkbenchWorker({
  pair,
  savedPoints,
  queueId,
  onComplete,
  onBack,
  onForward,
  onExit,
  onSavePoints,
  header,
  isSaved = false,
}: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const currentPointsRef = useRef<{ p1: Point[]; p2: Point[] }>({ p1: [], p2: [] });
  // Points suggested by the lightglue container when its automatic attempt failed.
  // Used as the initial state when the user hasn't already edited this pair in-session.
  const [suggestedInitialPoints, setSuggestedInitialPoints] = useState<
    { p1: Point[]; p2: Point[] } | undefined
  >(undefined);
  const suggestedTotalRef = useRef(0);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(!!savedPoints);

  useEffect(() => { 
    setSuggestedInitialPoints(undefined);
    suggestedTotalRef.current = 0;

    const hasSavedPoints = !!savedPoints;
    setSuggestionsLoaded(hasSavedPoints);
    let cancelled = false;
    (async () => {
      try {
        const dir = await resolveNeighbourDirection(
          client,
          pair.primaryImage.id,
          pair.secondaryImage.id
        );
        if (cancelled) return;
        const forPrimary = dir.isForward ? dir.suggestedPoints1 : dir.suggestedPoints2;
        const forSecondary = dir.isForward ? dir.suggestedPoints2 : dir.suggestedPoints1;
        const p1 = flatToPoints(forPrimary);
        const p2 = flatToPoints(forSecondary);
        // Only surface complete pairs — anything unmatched gets discarded.
        const n = Math.min(p1.length, p2.length);
        if (n > 0) {
          suggestedTotalRef.current = n;
          if (!hasSavedPoints) {
            const trimmed = { p1: p1.slice(0, n), p2: p2.slice(0, n) };
            setSuggestedInitialPoints(trimmed);
          }
        }
      } catch (err) {
        console.warn('Failed to load suggested homography points', err);
      } finally {
        if (!cancelled && !hasSavedPoints) setSuggestionsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pair.primaryImage.id, pair.secondaryImage.id, pair.pairKey, savedPoints]);

  const handlePointsChange = useCallback(
    (points: { p1: Point[]; p2: Point[] }) => {
      currentPointsRef.current = points;
    },
    []
  );

  const handleSave = useCallback(
    async (H: Matrix) => {
      setIsSaving(true);
      try {
        const flat: number[] = (H.toArray() as number[][]).flat();
        const flatInverse: number[] = (inv(H).toArray() as number[][]).flat();

        const dir = await resolveNeighbourDirection(
          client,
          pair.primaryImage.id,
          pair.secondaryImage.id
        );

        const kept = suggestedTotalRef.current > 0
          ? countSuggestedPointsKept(currentPointsRef.current)
          : undefined;

        await (client.models.ImageNeighbour.update as any)({
          image1Id: dir.image1Id,
          image2Id: dir.image2Id,
          homography: dir.isForward ? flat : flatInverse,
          homographySource: 'manual',
          ...(kept !== undefined ? { suggestedPointsKept: kept } : {}),
        });

        await (client as any).mutations.incrementQueueCount({ id: queueId });
        await pair.ack();
        onSavePoints(pair.pairKey, currentPointsRef.current);
        onComplete(pair.pairKey);
      } catch (error) {
        console.error('Failed to save homography', error);
      } finally {
        setIsSaving(false);
      }
    },
    [pair, queueId, onComplete, onSavePoints]
  );

  const handleSkip = useCallback(async () => {
    if (
      !window.confirm(
        "Are you sure you want to skip this pair? The images will remain neighbours but won't require registration."
      )
    )
      return;

    setIsSkipping(true);
    try {
      const dir = await resolveNeighbourDirection(
        client,
        pair.primaryImage.id,
        pair.secondaryImage.id
      );

      await (client.models.ImageNeighbour.update as any)({
        image1Id: dir.image1Id,
        image2Id: dir.image2Id,
        skipped: true,
      });

      await (client as any).mutations.incrementQueueCount({ id: queueId });
      await pair.ack();
      onSavePoints(pair.pairKey, currentPointsRef.current);
      onComplete(pair.pairKey);
    } catch (error) {
      console.error('Failed to skip pair', error);
    } finally {
      setIsSkipping(false);
    }
  }, [pair, queueId, onComplete, onSavePoints]);

  const handleSaveAndExit = useCallback(async () => {
    if (!onExit) return;
    const { p1, p2 } = currentPointsRef.current;
    if (
      p1.length >= MIN_HOMOGRAPHY_POINTS &&
      p2.length >= MIN_HOMOGRAPHY_POINTS
    ) {
      const shouldSave = window.confirm(
        'You have enough points to save a homography. Save before exiting?'
      );
      if (shouldSave) {
        const H = solveHomography(p1, p2);
        if (H) {
          await handleSave(H);
        }
      }
    }
    onExit();
  }, [onExit, handleSave]);

  const handleBack = useCallback(() => {
    onSavePoints(pair.pairKey, currentPointsRef.current);
    onBack?.();
  }, [pair.pairKey, onSavePoints, onBack]);

  const handleForward = useCallback(() => {
    onSavePoints(pair.pairKey, currentPointsRef.current);
    onForward?.();
  }, [pair.pairKey, onSavePoints, onForward]);

  if (!suggestionsLoaded) {
    return (
      <div className='d-flex justify-content-center align-items-center h-100'>
        <div className='text-muted'>Loading suggested points...</div>
      </div>
    );
  }

  return (
    <HomographyWorkbench
      images={[pair.primaryImage as any, pair.secondaryImage as any]}
      onSave={handleSave}
      onSkip={handleSkip}
      isSaving={isSaving}
      isSkipping={isSkipping}
      annotationSetId={pair.annotationSetId}
      initialPoints={savedPoints ?? suggestedInitialPoints}
      onPointsChange={handlePointsChange}
      isSaved={isSaved}
      headerLeft={
        <div className='d-flex align-items-center gap-2'>
          {header}
          {onBack && (
            <button
              className='btn btn-sm btn-outline-primary'
              onClick={handleBack}
              disabled={isSaving || isSkipping}
            >
              Previous Pair
            </button>
          )}
          {onForward && (
            <button
              className='btn btn-sm btn-outline-primary'
              onClick={handleForward}
              disabled={isSaving || isSkipping}
            >
              Next Pair
            </button>
          )}
        </div>
      }
      headerRight={
        onExit ? (
          <button
            className='btn btn-sm btn-outline-success'
            onClick={handleSaveAndExit}
            disabled={isSaving || isSkipping}
          >
            Save &amp; Exit
          </button>
        ) : undefined
      }
    />
  );
}
