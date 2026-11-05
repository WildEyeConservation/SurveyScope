export interface TaskSample {
  /** Time the task was on screen. */
  timeTakenMs: number;
  /** Time spent looking at an image that had not finished loading. */
  waitingMs: number;
  /** Network time spent fetching the task's tiles. */
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
// Load estimates rise fast and fall slowly, so the slow images set the lead.
const LOAD_ALPHA_UP = 0.5;
const LOAD_ALPHA_DOWN = 0.1;
const MIN_TASK_MS = 250;
// A pause counts as at most this many typical tasks.
const MAX_TASK_RATIO = 2;
// Waiting below this is not worth the extra bandwidth.
const WAITING_THRESHOLD_MS = 100;
// Back off when slot waits indicate saturation.
const SATURATED_SLOT_WAIT_MS = 1000;
const STORAGE_KEY = 'prefetchPlanner';

// Generous until the first tasks show what this browser needs.
export const initialPlannerState = (): PlannerState => ({
  depth: 3,
  taskMs: 0,
  loadMs: 0,
  waitingMs: 0,
  slotWaitMs: 0,
  samples: 0,
});

const ewma = (previous: number, next: number, first: boolean) =>
  first ? next : previous + ALPHA * (next - previous);

function nextLoad(previous: number, sample: number) {
  if (sample <= 0) return previous;
  if (previous <= 0) return sample;
  const alpha = sample > previous ? LOAD_ALPHA_UP : LOAD_ALPHA_DOWN;
  return previous + alpha * (sample - previous);
}

export function planPrefetch(
  state: PlannerState,
  sample: TaskSample,
  mountedAhead: number,
): PlannerState {
  const first = state.samples === 0;
  const timeTakenMs = first
    ? sample.timeTakenMs
    : Math.min(sample.timeTakenMs, MAX_TASK_RATIO * state.taskMs);
  const next: PlannerState = {
    ...state,
    samples: state.samples + 1,
    taskMs: ewma(state.taskMs, Math.max(MIN_TASK_MS, timeTakenMs), first),
    waitingMs: ewma(state.waitingMs, sample.waitingMs, first),
    slotWaitMs: ewma(state.slotWaitMs, sample.slotWaitMs, first),
    loadMs: nextLoad(state.loadMs, sample.loadMs),
  };
  const needed = Math.ceil(next.loadMs / next.taskMs) + 1 - mountedAhead;
  const target = Math.min(MAX_PREFETCH, Math.max(0, needed));
  const waiting = next.waitingMs >= WAITING_THRESHOLD_MS;
  if (next.slotWaitMs > SATURATED_SLOT_WAIT_MS) {
    next.depth = Math.max(0, state.depth - 1);
  } else if (
    state.depth < MAX_PREFETCH &&
    (target > state.depth || (waiting && target >= state.depth))
  ) {
    next.depth = state.depth + 1;
  } else if (target < state.depth && !waiting) {
    next.depth = state.depth - 1;
  }
  return next;
}

type PlannerStorage = Pick<Storage, 'getItem' | 'setItem'>;

function restore(storage: PlannerStorage | undefined): PlannerState {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    const state = { ...initialPlannerState(), ...saved };
    const valid = Object.values(state).every(
      (value) =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0,
    );
    if (valid) {
      state.depth = Math.min(MAX_PREFETCH, Math.round(state.depth));
      return state;
    }
  } catch {
    return initialPlannerState();
  }
  return initialPlannerState();
}

export function createPrefetchPlanner(
  mountedAhead: number,
  storage: PlannerStorage | undefined = typeof localStorage === 'undefined'
    ? undefined
    : localStorage,
) {
  let state = restore(storage);
  let skip = false;
  const listeners = new Set<() => void>();
  return {
    record(sample: TaskSample) {
      if (skip) {
        skip = false;
        return;
      }
      const previous = state.depth;
      state = planPrefetch(state, sample, mountedAhead);
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage may be full or blocked; planning still works for this page.
      }
      if (state.depth !== previous) listeners.forEach((listener) => listener());
    },
    // Excludes the cold start after opening the queue.
    skipNext() {
      skip = true;
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
