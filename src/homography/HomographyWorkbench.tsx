import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Redo2, Undo2 } from 'lucide-react';
import type { Matrix } from 'mathjs';
import { inv } from 'mathjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { ImageType } from '../schemaTypes';
import { makeTransform } from '../utils';
import {
  ManualHomographyEditor,
  MIN_HOMOGRAPHY_POINTS,
  solveHomography,
  type Point,
} from './ManualHomographyEditor';
import { MapLibrePairViewer } from './MapLibrePairViewer';

type Props = {
  images: [ImageType, ImageType];
  onSave: (H: Matrix) => void;
  onSkip?: () => void;
  onImagesReady?: () => void;
  isSaving?: boolean;
  isSkipping?: boolean;
  annotationSetId?: string;
  /** Navigation buttons rendered on the left of the toolbar (e.g. Back / Forward) */
  headerLeft?: React.ReactNode;
  /** Action buttons rendered on the right of the toolbar (e.g. Save & Exit) */
  headerRight?: React.ReactNode;
  /** Initial points to restore (e.g. when navigating back to a previously visited pair) */
  initialPoints?: { p1: Point[]; p2: Point[] };
  /** Called whenever the point state changes, so the parent can snapshot for back navigation */
  onPointsChange?: (points: { p1: Point[]; p2: Point[] }) => void;
  /** Whether this pair has already been saved */
  isSaved?: boolean;
  /**
   * If provided, a "View saved homography (red)" toggle appears next to the
   * Preview switch. When the toggle is on, these transforms draw a red
   * outline+grid overlay on each map showing the homography currently
   * stored in the DB. Pure visual reference — never affects map sync or
   * the live (cyan) preview. Toggle is hidden if this prop is omitted.
   */
  savedTransforms?:
    | [
        (c: [number, number]) => [number, number],
        (c: [number, number]) => [number, number],
      ]
    | null;
};

export function HomographyWorkbench({
  images,
  onSave,
  onSkip,
  onImagesReady,
  isSaving = false,
  isSkipping = false,
  annotationSetId,
  headerLeft,
  headerRight,
  initialPoints,
  onPointsChange,
  isSaved = false,
  savedTransforms,
}: Props) {
  const [showSavedHomography, setShowSavedHomography] = useState(false);
  const [points, setPoints] = useState<{ p1: Point[]; p2: Point[] }>(
    initialPoints ?? { p1: [], p2: [] },
  );
  const [history, setHistory] = useState<{ p1: Point[]; p2: Point[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ p1: Point[]; p2: Point[] }[]>(
    [],
  );
  const [previewHomography, setPreviewHomography] = useState(
    () =>
      !!initialPoints &&
      initialPoints.p1.length >= MIN_HOMOGRAPHY_POINTS &&
      initialPoints.p2.length >= MIN_HOMOGRAPHY_POINTS,
  );

  const points1 = points.p1;
  const points2 = points.p2;

  const setPoints1 = useCallback(
    (updater: Point[] | ((prev: Point[]) => Point[])) => {
      setPoints((prev) => ({
        ...prev,
        p1: typeof updater === 'function' ? updater(prev.p1) : updater,
      }));
    },
    [],
  );

  const setPoints2 = useCallback(
    (updater: Point[] | ((prev: Point[]) => Point[])) => {
      setPoints((prev) => ({
        ...prev,
        p2: typeof updater === 'function' ? updater(prev.p2) : updater,
      }));
    },
    [],
  );

  // Undo / redo
  const recordAction = useCallback(() => {
    setHistory((prev) => {
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        if (last.p1 === points.p1 && last.p2 === points.p2) return prev;
      }
      return [...prev.slice(-49), points];
    });
    setRedoStack([]);
  }, [points]);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((redo) => [points, ...redo]);
      setPoints(last);
      return prev.slice(0, -1);
    });
  }, [points]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setHistory((hist) => [...hist, points]);
      setPoints(next);
      return prev.slice(1);
    });
  }, [points]);

  useHotkeys(
    'ctrl+z, meta+z',
    (e) => {
      e.preventDefault();
      undo();
    },
    { enableOnFormTags: true },
  );

  useHotkeys(
    'ctrl+y, meta+shift+z, ctrl+shift+z',
    (e) => {
      e.preventDefault();
      redo();
    },
    { enableOnFormTags: true },
  );

  // Reset when images change
  useEffect(() => {
    setPoints(initialPoints ?? { p1: [], p2: [] });
    setHistory([]);
    setRedoStack([]);
    setPreviewHomography(
      !!initialPoints &&
        initialPoints.p1.length >= MIN_HOMOGRAPHY_POINTS &&
        initialPoints.p2.length >= MIN_HOMOGRAPHY_POINTS,
    );
  }, [images[0].id, images[1].id]);

  // Notify parent of points changes
  useEffect(() => {
    onPointsChange?.(points);
  }, [points, onPointsChange]);

  // Auto-enable preview at minimum point count
  const numPairs = Math.min(points1.length, points2.length);
  useEffect(() => {
    if (
      !previewHomography &&
      numPairs === MIN_HOMOGRAPHY_POINTS &&
      points1.length === points2.length
    ) {
      setPreviewHomography(true);
    }
  }, [numPairs, points1.length, points2.length]);

  const previewTransforms = useMemo(() => {
    if (!previewHomography) return null;
    if (
      points1.length < MIN_HOMOGRAPHY_POINTS ||
      points2.length < MIN_HOMOGRAPHY_POINTS
    )
      return null;
    const H = solveHomography(points1, points2);
    if (!H) return null;
    try {
      return [makeTransform(H), makeTransform(inv(H))] as [
        (c: [number, number]) => [number, number],
        (c: [number, number]) => [number, number],
      ];
    } catch {
      return null;
    }
  }, [previewHomography, points1, points2]);

  const canPreview =
    points1.length >= MIN_HOMOGRAPHY_POINTS &&
    points2.length >= MIN_HOMOGRAPHY_POINTS;

  return (
    <div className='flex h-full w-full flex-col gap-4 md:flex-row'>
      {/* Sidebar */}
      <div className='flex w-full flex-col gap-4' style={{ maxWidth: '360px' }}>
        <ManualHomographyEditor
          points1={points1}
          points2={points2}
          setPoints1={setPoints1}
          setPoints2={setPoints2}
          onSave={onSave}
          onSkip={onSkip}
          onAction={recordAction}
          isSaving={isSaving}
          isSkipping={isSkipping}
          isSaved={isSaved}
        />
      </div>

      {/* Main content */}
      <div className='flex h-full w-full flex-col items-center'>
        <div className='mb-2 flex w-full items-center'>
          {/* Left: navigation */}
          <div className='flex items-center gap-2'>{headerLeft}</div>

          {/* Center: preview toggle + undo/redo */}
          <div className='mx-auto flex items-center gap-4'>
            <div className='flex items-center gap-2'>
              <Switch
                id='preview-homography'
                checked={previewHomography}
                onCheckedChange={setPreviewHomography}
                disabled={!canPreview}
              />
              <Label htmlFor='preview-homography' className='mb-0'>
                Preview
              </Label>
            </div>
            {savedTransforms && (
              <div className='flex items-center gap-2'>
                <Switch
                  id='view-saved-homography'
                  checked={showSavedHomography}
                  onCheckedChange={setShowSavedHomography}
                />
                <Label htmlFor='view-saved-homography' className='mb-0'>
                  View saved homography (red)
                </Label>
              </div>
            )}
            <div className='flex items-center gap-1 border-l border-secondary ps-4'>
              <Button
                size='sm'
                variant='outline-secondary'
                onClick={undo}
                disabled={history.length === 0}
                title='Undo (Ctrl+Z)'
                className='flex items-center p-1'
              >
                <Undo2 size={16} />
              </Button>
              <Button
                size='sm'
                variant='outline-secondary'
                onClick={redo}
                disabled={redoStack.length === 0}
                title='Redo (Ctrl+Y / Ctrl+Shift+Z)'
                className='flex items-center p-1'
              >
                <Redo2 size={16} />
              </Button>
            </div>
          </div>

          {/* Right: save & exit */}
          <div className='flex items-center gap-2'>{headerRight}</div>
        </div>
        <MapLibrePairViewer
          onImagesReady={onImagesReady}
          key={`maplibre-${images[0].id}::${images[1].id}`}
          images={images}
          points={[points1, points2]}
          setPoints={[setPoints1, setPoints2]}
          previewTransforms={previewTransforms}
          savedTransforms={showSavedHomography ? savedTransforms : null}
          onAction={recordAction}
          annotationSetId={annotationSetId}
        />
      </div>
    </div>
  );
}
