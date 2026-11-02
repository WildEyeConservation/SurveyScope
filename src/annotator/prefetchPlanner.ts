export interface TaskSample {
  /** Time the task was on screen. */
  timeTakenMs: number;
  /** Time spent looking at an image that had not finished loading. */
  waitingMs: number;
  /** Network time spent getting the task's image ready. */
  loadMs: number;
  /** Average wait for a request slot; high means the connection is saturated. */
  slotWaitMs: number;
}

export interface PlannerState {
  depth: number;
  taskMs: number;
  loadMs: number;
  waitingMs: number;
  slotWaitMs: number;
  samples: number;
}

export const MAX_PREFETCH = 8;
const ALPHA = 0.2;
const MIN_TASK_MS = 250;
// Waiting below this is not worth the extra bandwidth.
const WAITING_THRESHOLD_MS = 100;
// Back off when slot waits indicate saturation.
const SATURATED_SLOT_WAIT_MS = 1000;

export const initialPlannerState = (): PlannerState => ({
  depth: 1,
  taskMs: 0,
  loadMs: 0,
  waitingMs: 0,
  slotWaitMs: 0,
  samples: 0,
});

const ewma = (previous: number, next: number, first: boolean) =>
  first ? next : previous + ALPHA * (next - previous);

export function planPrefetch(
  state: PlannerState,
  sample: TaskSample,
  mountedAhead: number
): PlannerState {
  const first = state.samples === 0;
  const next: PlannerState = {
    ...state,
    samples: state.samples + 1,
    taskMs: ewma(state.taskMs, Math.max(MIN_TASK_MS, sample.timeTakenMs), first),
    waitingMs: ewma(state.waitingMs, sample.waitingMs, first),
    slotWaitMs: ewma(state.slotWaitMs, sample.slotWaitMs, first),
    loadMs:
      sample.loadMs > 0
        ? ewma(state.loadMs, sample.loadMs, state.loadMs === 0)
        : state.loadMs,
  };
  const needed = Math.ceil(next.loadMs / next.taskMs) + 1 - mountedAhead;
  const target = Math.min(MAX_PREFETCH, Math.max(0, needed));
  if (next.slotWaitMs > SATURATED_SLOT_WAIT_MS) {
    next.depth = Math.max(0, state.depth - 1);
  } else if (target > state.depth) {
    if (next.waitingMs >= WAITING_THRESHOLD_MS) next.depth = state.depth + 1;
  } else if (target < state.depth) {
    next.depth = state.depth - 1;
  }
  return next;
}

export function createPrefetchPlanner(mountedAhead: number) {
  let state = initialPlannerState();
  const listeners = new Set<() => void>();
  return {
    record(sample: TaskSample) {
      const previous = state.depth;
      state = planPrefetch(state, sample, mountedAhead);
      if (state.depth !== previous) listeners.forEach((listener) => listener());
    },
    depth: () => state.depth,
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// The annotation queue mounts the current task plus two ahead.
export const ANNOTATION_PRELOAD = 3;
export const prefetchPlanner = createPrefetchPlanner(ANNOTATION_PRELOAD - 1);
