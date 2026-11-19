import { useSyncExternalStore } from 'react';
import type { LabelRef } from './types';

type State = {
  paletteOpen: boolean;
  // Set when opened on a label, e.g. from a legend peek.
  label: LabelRef | null;
};

let state: State = { paletteOpen: false, label: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const notebook = {
  openPalette: (label: LabelRef | null = null) =>
    set({ paletteOpen: true, label }),
  closePalette: () => set({ paletteOpen: false, label: null }),
  togglePalette: () =>
    set(
      state.paletteOpen
        ? { paletteOpen: false, label: null }
        : { paletteOpen: true },
    ),
};

export function useNotebookState(): State {
  return useSyncExternalStore(subscribe, () => state);
}
