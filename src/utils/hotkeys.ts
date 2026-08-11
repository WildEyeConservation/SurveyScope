/*
Shared parsing/matching for user-configured shortcut keys (Category.shortcutKey,
InfoTag.shortcutKey).

Shortcuts are recorded in LabelEditor with react-hotkeys-hook's useRecordHotkeys,
which stores the *physical* key name derived from KeyboardEvent.code and joins
multi-key recordings with '+'. A stored shortcutKey can therefore be 'h',
'period' or 'ctrl+h' - none of which can be compared against KeyboardEvent.key
directly:

  - 'ctrl+h' never equals event.key ('h'), so combos silently do nothing, or
    worse, match a different category that owns the plain key.
  - punctuation records as its code name ('period', 'comma', 'slash') while
    event.key is the character ('.', ',', '/').
  - on non-US layouts the recorded physical key and the produced character
    differ outright ('a' recorded on AZERTY KeyA, event.key is 'q').

Everything here normalises both sides to the same canonical form
(modifiers sorted, then keys, joined with '+'), so all three cases match.
*/

const MODIFIERS = ['alt', 'ctrl', 'meta', 'mod', 'shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

// Mirrors react-hotkeys-hook's internal `mappedKeys` table so that our canonical
// form agrees with the one the library uses when it decides a hotkey fired.
const MAPPED_KEYS: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  control: 'ctrl',
  '.': 'period',
  ',': 'comma',
  '-': 'slash',
  ' ': 'space',
  '`': 'backquote',
  '#': 'backslash',
  '+': 'bracketright',
  shiftleft: 'shift',
  shiftright: 'shift',
  altleft: 'alt',
  altright: 'alt',
  metaleft: 'meta',
  metaright: 'meta',
  osleft: 'meta',
  osright: 'meta',
  controlleft: 'ctrl',
  controlright: 'ctrl',
};

const DISPLAY_KEYS: Record<string, string> = {
  backquote: '`',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
  comma: ',',
  down: '↓',
  equal: '=',
  escape: 'Esc',
  left: '←',
  minus: '-',
  period: '.',
  quote: "'",
  right: '→',
  semicolon: ';',
  slash: '/',
  up: '↑',
};

const DISPLAY_MODIFIERS: Record<Modifier, string> = {
  alt: 'Alt',
  ctrl: 'Ctrl',
  meta: 'Meta',
  mod: 'Mod',
  shift: 'Shift',
};

/** Structural stand-in for react-hotkeys-hook's HotkeysEvent (not exported by the package). */
export type ParsedHotkey = {
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  mod?: boolean;
  keys?: readonly string[];
};

function isModifier(key: string): key is Modifier {
  return (MODIFIERS as readonly string[]).includes(key);
}

/** Normalises a single key name/character, matching react-hotkeys-hook's mapKey. */
export function mapKeyName(key: string | null | undefined): string {
  const lower = (key ?? '').trim().toLowerCase();
  if (lower === '') return '';
  return (MAPPED_KEYS[lower] ?? lower).replace(/key|digit|numpad|arrow/, '');
}

/**
 * Splits a stored combo on '+' while preserving a literal '+' as a key
 * ('+' -> ['+'], 'ctrl+h' -> ['ctrl', 'h'], 'shift++' -> ['shift', '+']).
 */
function splitCombo(shortcutKey: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const char of shortcutKey) {
    if (char === '+' && current !== '') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current !== '') parts.push(current);
  else if (shortcutKey.endsWith('+')) parts.push('+');
  return parts;
}

function canonical(modifiers: readonly string[], keys: readonly string[]): string {
  const mods = MODIFIERS.filter((m) => modifiers.includes(m));
  const rest = keys.filter((k) => k !== '' && !isModifier(k));
  return [...mods, ...[...rest].sort()].join('+');
}

/** Canonical form of a stored shortcutKey. 'Ctrl+H' -> 'ctrl+h', '.' -> 'period'. */
export function normalizeShortcutKey(
  shortcutKey: string | null | undefined
): string {
  if (!shortcutKey) return '';
  const parts = splitCombo(shortcutKey.trim().toLowerCase()).map(mapKeyName);
  return canonical(parts, parts);
}

/**
 * Canonical form of the hotkey react-hotkeys-hook reports as matched. Use this
 * rather than event.key to work out which shortcut actually fired.
 */
export function canonicalHotkeyFromParsed(hotkey: ParsedHotkey): string {
  const modifiers = MODIFIERS.filter((m) => hotkey[m]);
  return canonical(modifiers, hotkey.keys ?? []);
}

/**
 * Candidate canonical forms for a raw KeyboardEvent, for screens that listen on
 * keydown directly instead of going through react-hotkeys-hook. Both the
 * physical key (event.code) and the produced character (event.key) are offered,
 * since a shortcut may have been recorded as either.
 */
export function canonicalHotkeysFromEvent(event: KeyboardEvent): string[] {
  const modifiers = MODIFIERS.filter(
    (m) =>
      (m === 'alt' && event.altKey) ||
      (m === 'ctrl' && event.ctrlKey) ||
      (m === 'meta' && event.metaKey) ||
      (m === 'shift' && event.shiftKey)
  );
  const code = mapKeyName(event.code);
  const char = mapKeyName(event.key);
  const candidates = [
    canonical(modifiers, [code]),
    canonical(modifiers, [char]),
  ];
  // A shortcut recorded as a shifted character ('+', '?') is stored as the
  // character alone, so match it on the character with shift dropped.
  if (modifiers.length === 1 && modifiers[0] === 'shift') {
    candidates.push(canonical([], [char]));
  }
  return candidates.filter(Boolean);
}

/** Finds the item whose shortcutKey matches a raw keydown event, if any. */
export function findShortcutMatch<T>(
  event: KeyboardEvent,
  items: readonly T[],
  getShortcutKey: (item: T) => string | null | undefined
): T | undefined {
  const candidates = canonicalHotkeysFromEvent(event);
  if (candidates.length === 0) return undefined;
  return items.find((item) => {
    const normalized = normalizeShortcutKey(getShortcutKey(item));
    return normalized !== '' && candidates.includes(normalized);
  });
}

/** Human-readable rendering of a stored shortcutKey. 'ctrl+h' -> 'Ctrl+H'. */
export function formatShortcutKey(
  shortcutKey: string | null | undefined
): string {
  if (!shortcutKey) return '';
  const parts = splitCombo(shortcutKey.trim().toLowerCase()).map(mapKeyName);
  const mods = MODIFIERS.filter((m) => parts.includes(m)).map(
    (m) => DISPLAY_MODIFIERS[m]
  );
  const keys = parts
    .filter((k) => k !== '' && !isModifier(k))
    .map(
      (k) =>
        DISPLAY_KEYS[k] ??
        (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1))
    );
  return [...mods, ...keys].join('+');
}
