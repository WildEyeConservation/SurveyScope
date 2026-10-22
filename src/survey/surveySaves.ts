import { useSyncExternalStore } from 'react';

// Transect and strata saves outlive their tab and depend on each other's rows.
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export async function runSurveySave<T>(
  projectId: string,
  save: () => Promise<T>
): Promise<T> {
  const run = (pending.get(projectId) ?? Promise.resolve()).then(save);
  const settled = run.then(
    () => {},
    () => {}
  );
  pending.set(projectId, settled);
  notify();
  try {
    return await run;
  } finally {
    if (pending.get(projectId) === settled) {
      pending.delete(projectId);
      notify();
    }
  }
}

export function surveySaveSettled(projectId: string): Promise<void> {
  return pending.get(projectId) ?? Promise.resolve();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSurveySaving(projectId: string): boolean {
  return useSyncExternalStore(subscribe, () => pending.has(projectId));
}
