import { useSyncExternalStore } from 'react';

// Transect and strata saves outlive their tab and depend on each other's rows.
const pending = new Map<string, Promise<void>>();
const completed = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export async function runSurveySave<T>(
  projectId: string,
  save: () => Promise<T>,
): Promise<T> {
  const run = (pending.get(projectId) ?? Promise.resolve()).then(save);
  // Counted before anyone awaiting the save resumes.
  const count = () => {
    completed.set(projectId, surveySavesCompleted(projectId) + 1);
  };
  const settled = run.then(count, count);
  pending.set(projectId, settled);
  notify();
  try {
    return await run;
  } finally {
    if (pending.get(projectId) === settled) pending.delete(projectId);
    notify();
  }
}

export function surveySavesCompleted(projectId: string): number {
  return completed.get(projectId) ?? 0;
}

export function surveySaveSettled(projectId: string): Promise<void> {
  return pending.get(projectId) ?? Promise.resolve();
}

export function subscribeSurveySaves(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSurveySaving(projectId: string): boolean {
  return useSyncExternalStore(subscribeSurveySaves, () =>
    pending.has(projectId),
  );
}
