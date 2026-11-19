import { SPECIES_SEARCH_SHORTCUTS } from '../species-notebook/shortcut';
import { normalizeShortcutKey } from '../utils/hotkeys';
import {
  compareByCommonness,
  isCommonLabel,
  normalizeLabelName,
} from './labelCatalog';

export const APP_RESERVED_SHORTCUTS = [
  'space',
  'tab',
  'enter',
  'escape',
  'backspace',
  'delete',
  'left',
  'right',
  'up',
  'down',
  'shift+left',
  'shift+right',
  'ctrl+left',
  'ctrl+right',
  'equal',
  'shift+equal',
  'add',
  'ctrl+z',
  'ctrl+y',
  'ctrl+shift+z',
  'meta+z',
  'meta+shift+z',
  ...SPECIES_SEARCH_SHORTCUTS,
].map(normalizeShortcutKey);

export function isSpeciesSearchShortcutKey(shortcutKey: string): boolean {
  return SPECIES_SEARCH_SHORTCUTS.map(normalizeShortcutKey).includes(
    normalizeShortcutKey(shortcutKey),
  );
}

// Chrome handles these before the page sees them, so preventDefault cannot stop them.
const BROWSER_RESERVED = new Set(
  [
    'ctrl+w',
    'ctrl+t',
    'ctrl+n',
    'ctrl+q',
    'ctrl+f4',
    'ctrl+tab',
    'ctrl+pageup',
    'ctrl+pagedown',
    'ctrl+shift+t',
    'ctrl+shift+n',
    'ctrl+shift+w',
    'ctrl+shift+q',
    'ctrl+shift+tab',
    'alt+f4',
    'meta+w',
    'meta+t',
    'meta+n',
    'meta+q',
    'meta+shift+t',
    'meta+shift+n',
    'meta+shift+w',
    ...'123456789'.split('').flatMap((d) => [`ctrl+${d}`, `meta+${d}`]),
  ].map(normalizeShortcutKey),
);

export function isBrowserReservedShortcut(shortcutKey: string): boolean {
  return BROWSER_RESERVED.has(normalizeShortcutKey(shortcutKey));
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '1234567890'.split('');
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const SAFE_CTRL_KEYS = ['b', 'i', 'm'];

export function salientKeys(name: string): string[] {
  const words = name
    .normalize('NFKD')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const chars = words.join('').split('');
  const ordered = [
    ...words.map((w) => w[0]),
    ...chars.filter((c) => /[a-z]/.test(c) && !VOWELS.has(c)),
    ...chars.filter((c) => VOWELS.has(c)),
    ...chars.filter((c) => /[0-9]/.test(c)),
  ];
  return [...new Set(ordered)];
}

function candidates(name: string): string[] {
  const own = salientKeys(name);
  const ownLetters = own.filter((k) => /[a-z]/.test(k));
  const otherLetters = LETTERS.filter((l) => !own.includes(l));
  const digits = [...own.filter((k) => /[0-9]/.test(k)), ...DIGITS];
  const shift = (keys: string[]) => keys.map((k) => `shift+${k}`);
  const ctrl = [
    ...ownLetters.filter((l) => SAFE_CTRL_KEYS.includes(l)),
    ...SAFE_CTRL_KEYS,
  ].map((k) => `ctrl+${k}`);
  const tiers = isCommonLabel(name)
    ? [
        own,
        shift(ownLetters),
        digits,
        otherLetters,
        shift(digits),
        shift(otherLetters),
      ]
    : [
        shift(ownLetters),
        own,
        shift(digits),
        digits,
        shift(otherLetters),
        otherLetters,
      ];
  return [...new Set([...tiers.flat(), ...ctrl])];
}

function optionsFor(name: string): string[] {
  if (normalizeLabelName(name) === 'falsepositive') return ['+'];
  return candidates(name).filter((key) => !isBrowserReservedShortcut(key));
}

export function suggestShortcutKey(
  name: string,
  takenKeys: Iterable<string | null | undefined>,
): string | undefined {
  if (!name.trim()) return undefined;
  const taken = new Set(APP_RESERVED_SHORTCUTS);
  for (const key of takenKeys) taken.add(normalizeShortcutKey(key));
  return optionsFor(name).find((key) => !taken.has(normalizeShortcutKey(key)));
}

// Allocate in rounds so fallbacks cannot take another label's first choice.
export function suggestShortcutKeys<
  T extends { name: string; shortcutKey: string },
>(labels: readonly T[]): string[] {
  const keys = labels.map((l) => l.shortcutKey);
  const taken = new Set(APP_RESERVED_SHORTCUTS);
  for (const key of keys) taken.add(normalizeShortcutKey(key));
  const pending = labels
    .map((l, i) => ({ name: l.name, i }))
    .filter(({ i, name }) => !keys[i] && name.trim())
    .sort((a, b) => compareByCommonness(a.name, b.name))
    .map(({ name, i }) => ({ i, options: optionsFor(name) }));
  const depth = Math.max(0, ...pending.map((p) => p.options.length));
  for (let round = 0; round < depth; round++) {
    for (const p of pending) {
      const option = p.options[round];
      if (keys[p.i] || option === undefined) continue;
      const normalized = normalizeShortcutKey(option);
      if (taken.has(normalized)) continue;
      keys[p.i] = option;
      taken.add(normalized);
    }
  }
  return keys;
}
