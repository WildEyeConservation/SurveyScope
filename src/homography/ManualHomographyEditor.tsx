import { useCallback, useMemo, useState } from 'react';
import { Matrix, matrix, multiply, transpose, inv } from 'mathjs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Trash2,
  Info,
  Save,
  SkipForward,
  Target,
  Circle,
  ChevronDown,
  ChevronUp,
  X,
  SquareDashed,
} from 'lucide-react';
import { POINT_COLORS } from '../maplibre-viewer/MapLibreImageViewer';

export type Point = { id: string; x: number; y: number };

function buildDesignMatrix(points1: Point[], points2: Point[]) {
  // Build A (2N x 8) and b (2N x 1) for least squares with h33 fixed to 1
  const rows: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < Math.min(points1.length, points2.length); i++) {
    const { x, y } = points1[i];
    const { x: xp, y: yp } = points2[i];
    rows.push([x, y, 1, 0, 0, 0, -x * xp, -y * xp]);
    b.push(xp);
    rows.push([0, 0, 0, x, y, 1, -x * yp, -y * yp]);
    b.push(yp);
  }
  return { A: matrix(rows), b: matrix(b) };
}

export const MIN_HOMOGRAPHY_POINTS = 4;

export function solveHomography(points1: Point[], points2: Point[]): Matrix | null {
  if (points1.length < MIN_HOMOGRAPHY_POINTS || points2.length < MIN_HOMOGRAPHY_POINTS) return null;
  const { A, b } = buildDesignMatrix(points1, points2);
  // Normal equations: (A^T A) u = A^T b
  const At = transpose(A) as Matrix;
  const AtA = multiply(At, A) as Matrix;
  const Atb = multiply(At, b) as Matrix;
  // Solve using inverse (sufficient for small 8x8)
  const u = multiply(inv(AtA), Atb) as Matrix; // 8x1

  const h11 = u.get([0]);
  const h12 = u.get([1]);
  const h13 = u.get([2]);
  const h21 = u.get([3]);
  const h22 = u.get([4]);
  const h23 = u.get([5]);
  const h31 = u.get([6]);
  const h32 = u.get([7]);
  const H = matrix([
    [h11, h12, h13],
    [h21, h22, h23],
    [h31, h32, 1],
  ]);
  return H;
}

/**
 * Compute per-point symmetric reprojection error.
 * For each pair, measures how far H(p1) is from p2 AND how far H_inv(p2) is from p1,
 * then returns the RMS of both directions per point.
 */
export function computeReprojectionErrors(
  points1: Point[],
  points2: Point[]
): number[] | null {
  const n = Math.min(points1.length, points2.length);
  if (n < MIN_HOMOGRAPHY_POINTS) return null;
  const H = solveHomography(
    points1.slice(0, n),
    points2.slice(0, n)
  );
  if (!H) return null;

  let Hinv: Matrix;
  try {
    Hinv = inv(H);
  } catch {
    return null;
  }

  const apply = (M: Matrix, x: number, y: number): [number, number] => {
    const r = multiply(M, [x, y, 1]).valueOf() as number[];
    return [r[0] / r[2], r[1] / r[2]];
  };

  const errors: number[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = apply(H, points1[i].x, points1[i].y);
    const fwdErr2 = (px - points2[i].x) ** 2 + (py - points2[i].y) ** 2;

    const [qx, qy] = apply(Hinv, points2[i].x, points2[i].y);
    const bwdErr2 = (qx - points1[i].x) ** 2 + (qy - points1[i].y) ** 2;

    errors.push(Math.sqrt((fwdErr2 + bwdErr2) / 2));
  }
  return errors;
}

export function ManualHomographyEditor({
  points1,
  points2,
  setPoints1,
  setPoints2,
  onSave,
  onSkip,
  onAction,
  isSaving = false,
  isSkipping = false,
  isSaved = false,
}: {
  points1: Point[];
  points2: Point[];
  setPoints1: (updater: Point[] | ((prev: Point[]) => Point[])) => void;
  setPoints2: (updater: Point[] | ((prev: Point[]) => Point[])) => void;
  onSave: (H: Matrix) => void;
  onSkip?: () => void;
  onAction?: () => void;
  isSaving?: boolean;
  isSkipping?: boolean;
  isSaved?: boolean;
}) {
  const [moreInformation, setMoreInformation] = useState(false);
  const canCompute =
    points1.length >= MIN_HOMOGRAPHY_POINTS &&
    points2.length >= MIN_HOMOGRAPHY_POINTS &&
    points1.length === points2.length;

  const handleRemovePair = useCallback(
    (index: number) => {
      onAction?.();
      setPoints1((prev) => prev.filter((_, i) => i !== index));
      setPoints2((prev) => prev.filter((_, i) => i !== index));
    },
    [setPoints1, setPoints2, onAction]
  );

  const handleSave = useCallback(() => {
    const H = solveHomography(points1, points2);
    if (!H) return;
    onSave(H);
  }, [points1, points2, onSave]);

  const handleSkip = useCallback(() => {
    onSkip?.();
  }, [onSkip]);

  const handleRemovePoint1 = useCallback(
    (index: number) => {
      onAction?.();
      setPoints1((prev) => prev.filter((_, i) => i !== index));
      // Move the orphaned point2 to the end so existing pairings stay intact
      setPoints2((prev) => {
        if (index >= prev.length) return prev;
        const orphan = prev[index];
        return [...prev.filter((_, i) => i !== index), orphan];
      });
    },
    [setPoints1, setPoints2, onAction]
  );

  const handleRemovePoint2 = useCallback(
    (index: number) => {
      onAction?.();
      setPoints2((prev) => prev.filter((_, i) => i !== index));
      // Move the orphaned point1 to the end so existing pairings stay intact
      setPoints1((prev) => {
        if (index >= prev.length) return prev;
        const orphan = prev[index];
        return [...prev.filter((_, i) => i !== index), orphan];
      });
    },
    [setPoints1, setPoints2, onAction]
  );

  const reprojErrors = useMemo(
    () => computeReprojectionErrors(points1, points2),
    [points1, points2]
  );

  const tableRows = useMemo(() => {
    const maxLen = Math.max(points1.length, points2.length);
    return new Array(maxLen).fill(0).map((_, i) => ({
      i,
      p1: points1[i] ?? null,
      p2: points2[i] ?? null,
      error: reprojErrors?.[i] ?? null,
    }));
  }, [points1, points2, reprojErrors]);

  return (
    <Card className='w-full h-full border-0 shadow-sm'>
      <CardHeader className='border-b border-secondary py-4'>
        <div className='flex items-center justify-between'>
          <CardTitle className='mb-0 flex items-center gap-2'>
            <SquareDashed size={20} className='text-info' />
            Homography Creation
          </CardTitle>
          <Button
            variant='link'
            className='p-0 text-info no-underline flex items-center gap-1 text-sm'
            onClick={() => setMoreInformation(!moreInformation)}
          >
            {moreInformation ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {moreInformation ? 'Hide' : 'Help'}
          </Button>
        </div>
        {moreInformation && (
          <div className='mt-4 pt-4 border-t border-secondary'>
            <div className='flex items-center gap-2 mb-2 text-info'>
              <Info size={16} />
              <span className='font-bold text-sm'>Instructions</span>
            </div>
            <ul className='text-sm ps-4' style={{ opacity: 0.9, lineHeight: '1.6' }}>
              <li>Select at least {MIN_HOMOGRAPHY_POINTS} corresponding points on both images. More points typically yield a better fit.</li>
              <li>Aim to cover as much area as possible.</li>
              <li>Avoid placing points in straight lines.</li>
              <li>Right-click a marker to remove/swap it or press <b>Esc</b> to close the popup.</li>
              <li>Preview will be available after 4 pairs have been created.</li>
            </ul>
            <div className='flex items-center gap-2 mb-2 mt-4 text-info'>
              <Target size={14} />
              <span className='font-bold text-sm'>Shortcuts</span>
            </div>
            <ul className='text-sm mb-0 list-none ps-4' style={{ lineHeight: '1.6' }}>
              <li><kbd style={{ padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>Ctrl + Z</kbd> Undo</li>
              <li><kbd style={{ padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>Ctrl + Y</kbd> / <kbd style={{ padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>Ctrl+Shift+Z</kbd> Redo</li>
              <li><kbd style={{ padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>Esc</kbd> Close context menu</li>
            </ul>
          </div>
        )}
      </CardHeader>
      <CardContent className='p-0 flex flex-col overflow-hidden'>
        <div className='grow overflow-auto p-4'>
          <div className='flex flex-col gap-2'>
            {tableRows.map(({ i, p1, p2 }) => {
              const color = POINT_COLORS[i % POINT_COLORS.length];
              return (
                <div
                  key={`pair-${i}`}
                  style={{
                    background: '#5B6977',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '6px',
                    overflow: 'hidden',
                    display: 'flex',
                  }}
                >
                  {/* Colored number strip */}
                  <div
                    style={{
                      background: color,
                      width: '24px',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: '#fff',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className='flex items-center gap-2 grow' style={{ padding: '8px' }}>
                    {/* Image 1 Point */}
                    <div className='grow p-2' style={{ background: '#4E5D6C', borderRadius: '4px' }}>
                      {p1 ? (
                        <div className='flex items-center justify-between'>
                          <span className='text-sm mono'>
                            {Math.round(p1.x)}, {Math.round(p1.y)}
                          </span>
                          <Button
                            size='sm'
                            variant='link'
                            className='p-0 text-muted-foreground'
                            onClick={() => handleRemovePoint1(i)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      ) : (
                        <span className='opacity-50 text-sm italic'>Pending...</span>
                      )}
                    </div>

                    {/* Image 2 Point */}
                    <div className='grow p-2' style={{ background: '#4E5D6C', borderRadius: '4px' }}>
                      {p2 ? (
                        <div className='flex items-center justify-between'>
                          <span className='text-sm mono'>
                            {Math.round(p2.x)}, {Math.round(p2.y)}
                          </span>
                          <Button
                            size='sm'
                            variant='link'
                            className='p-0 text-muted-foreground'
                            onClick={() => handleRemovePoint2(i)}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      ) : (
                        <span className='opacity-50 text-sm italic'>Pending...</span>
                      )}
                    </div>

                    {/* Pair removal */}
                    {p1 && p2 && (
                      <Button
                        size='sm'
                        variant='link'
                        className='p-0 text-danger opacity-75'
                        onClick={() => handleRemovePair(i)}
                      >
                        <X size={16} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}

            {tableRows.length === 0 && (
              <div className='text-center py-6 opacity-50 text-sm'>
                <Circle size={24} className='mb-2 opacity-25' />
                <p className='mb-0'>No points yet. Click on both<br />images to begin matching.</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <div className='flex flex-col gap-4'>
          {/* TODO: requires testing – Total RMS display
          {reprojErrors && reprojErrors.length > 0 && (
            <div className='text-center text-sm mb-1' style={{ opacity: 0.8 }}>
              Total RMS:{' '}
              <span
                style={{
                  fontWeight: 600,
                  color:
                    Math.sqrt(
                      reprojErrors.reduce((s, e) => s + e * e, 0) / reprojErrors.length
                    ) < 3
                      ? '#3cb44b'
                      : Math.sqrt(
                          reprojErrors.reduce((s, e) => s + e * e, 0) / reprojErrors.length
                        ) < 10
                      ? '#ffc107'
                      : '#e6194b',
                }}
              >
                {Math.sqrt(
                  reprojErrors.reduce((s, e) => s + e * e, 0) / reprojErrors.length
                ).toFixed(1)}
                px
              </span>
            </div>
          )}
          */}
          {isSaved && (
            <Badge variant='success' className='self-center'>
              Saved
            </Badge>
          )}
          <Button
            size='sm'
            onClick={handleSave}
            disabled={!canCompute || isSaving}
            className='w-full flex items-center justify-center gap-2 py-2 mt-2'
            variant={canCompute ? (isSaved ? 'warning' : 'primary') : 'secondary'}
          >
            <Save size={16} />
            {isSaving
              ? 'Saving...'
              : isSaved
              ? 'Overwrite Homography'
              : 'Save Homography'}
          </Button>

          {!isSaved && (
            <div className='pt-4 border-t border-secondary'>
              <p className='text-sm opacity-50 mb-2'>No overlap? Skip this pair.</p>
              <Button
                size='sm'
                className='w-full flex items-center justify-center gap-2 mb-2'
                variant='outline-warning'
                onClick={() => handleSkip()}
                disabled={isSkipping}
              >
                <SkipForward size={14} />
                {isSkipping ? 'Skipping...' : 'Skip Pair'}
              </Button>
            </div>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
