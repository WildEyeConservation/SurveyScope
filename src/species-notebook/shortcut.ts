type KeyLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

// Stored like LabelEditor records shortcuts, so labels can't take them.
export const SPECIES_SEARCH_SHORTCUTS = ['ctrl+k', 'meta+k'];

export function isSpeciesSearchShortcut(event: KeyLike): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.ctrlKey === event.metaKey) return false;
  return event.code === 'KeyK' || event.key.toLowerCase() === 'k';
}

export function speciesShortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

// Keeps typing and arrows in a notebook away from a workflow's window hotkeys.
export const stopKeys = (event: { stopPropagation: () => void }) =>
  event.stopPropagation();
