import { createContext, useContext, useLayoutEffect } from 'react';
import {
  useHotkeys,
  type HotkeyCallback,
  type Options,
} from 'react-hotkeys-hook';
import { useNotebookState } from './store';

export type PaletteViewer = {
  hotkeyTarget: HTMLElement | null;
  onUserZoom: (scale: number) => void;
};

export const PaletteViewerContext = createContext<PaletteViewer | null>(null);

// Scope hotkeys to the notebook viewer while the palette is open.
export function useViewerHotkeys(
  keys: string,
  callback: HotkeyCallback,
  options: Options & { enabled: boolean },
  deps?: unknown[],
) {
  const palette = useContext(PaletteViewerContext);
  const { paletteOpen } = useNotebookState();
  const target = palette?.hotkeyTarget ?? null;
  const enabled = options.enabled && (palette ? target !== null : !paletteOpen);
  const setTarget = useHotkeys(keys, callback, { ...options, enabled }, deps);
  useLayoutEffect(() => setTarget(target), [setTarget, target]);
}
