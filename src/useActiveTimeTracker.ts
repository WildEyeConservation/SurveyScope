import { useCallback, useEffect, useRef } from 'react';

/**
 * Measures how long a user actually worked on something, rather than how long
 * it was open.
 *
 * Elapsed time is accumulated between user interactions; any gap longer than
 * the idle threshold is treated as away-from-keyboard and excluded. That
 * matters for long, high-variance tasks — an image pair holding 200 animals
 * can legitimately take half an hour, so a cap loose enough to be fair to it
 * would also swallow a lunch break.
 *
 * The species labelling workflow instead records plain wall-clock between the
 * task becoming visible and being submitted, bounded by a tight per-task cap
 * (see useCreateObservation). That works there because a task is inherently
 * short; it does not transfer to this shape of work.
 */

const DEFAULT_IDLE_GAP_MS = 90_000;
// The shared workflow statistics contract rejects durations above 24 hours
// outright, so an accumulated total is always clamped well below that.
const MAX_ACTIVE_MS = 12 * 60 * 60 * 1000;

export interface ActiveTimeTracker {
  /** Milliseconds of active work since the last reset, excluding idle gaps. */
  read: () => number;
  /** Starts a fresh measurement, returning the total that was in progress. */
  reset: () => number;
}

export function useActiveTimeTracker(
  options: { idleGapMs?: number } = {}
): ActiveTimeTracker {
  const idleGapMs = options.idleGapMs ?? DEFAULT_IDLE_GAP_MS;
  const accumulatedRef = useRef(0);
  const lastTickRef = useRef<number>(Date.now());

  // Folds the time since the previous interaction into the total, dropping it
  // when it is long enough to have been a break.
  const settle = useCallback(() => {
    const now = Date.now();
    const delta = now - lastTickRef.current;
    lastTickRef.current = now;
    if (delta > 0 && delta <= idleGapMs) {
      accumulatedRef.current += delta;
    }
  }, [idleGapMs]);

  useEffect(() => {
    const onActivity = () => settle();
    // Same signals the transect heartbeat already treats as activity.
    window.addEventListener('pointerdown', onActivity, true);
    window.addEventListener('keydown', onActivity, true);
    window.addEventListener('wheel', onActivity, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onActivity, true);
      window.removeEventListener('keydown', onActivity, true);
      window.removeEventListener('wheel', onActivity, true);
    };
  }, [settle]);

  const read = useCallback(() => {
    // Fold in the time since the last interaction so a total read mid-task is
    // not stale, applying the same idle rule.
    settle();
    return Math.min(Math.round(accumulatedRef.current), MAX_ACTIVE_MS);
  }, [settle]);

  const reset = useCallback(() => {
    const total = read();
    accumulatedRef.current = 0;
    lastTickRef.current = Date.now();
    return total;
  }, [read]);

  return { read, reset };
}
