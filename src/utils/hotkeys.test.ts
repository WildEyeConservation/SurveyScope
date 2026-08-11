import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalHotkeyFromParsed,
  findShortcutMatch,
  formatShortcutKey,
  normalizeShortcutKey,
} from './hotkeys';

type Category = { id: string; shortcutKey: string | null };

/** Minimal stand-in for the fields the matcher reads off a keydown event. */
function keyEvent(
  key: string,
  code: string,
  modifiers: Partial<
    Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>
  > = {}
): KeyboardEvent {
  return {
    key,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  } as unknown as KeyboardEvent;
}

test('stored shortcuts normalise to the same form the matcher produces', () => {
  assert.equal(normalizeShortcutKey('ctrl+h'), 'ctrl+h');
  assert.equal(normalizeShortcutKey('Ctrl+H'), 'ctrl+h');
  assert.equal(normalizeShortcutKey('h+ctrl'), 'ctrl+h');
  assert.equal(normalizeShortcutKey('shift+8'), 'shift+8');
  assert.equal(normalizeShortcutKey('.'), 'period');
  assert.equal(normalizeShortcutKey(null), '');
});

test('the hotkey react-hotkeys-hook reports as matched resolves the category', () => {
  assert.equal(
    canonicalHotkeyFromParsed({ ctrl: true, keys: ['h'] }),
    'ctrl+h'
  );
  assert.equal(canonicalHotkeyFromParsed({ keys: ['h'] }), 'h');
  // Modifiers repeated inside keys must not leak into the key part.
  assert.equal(
    canonicalHotkeyFromParsed({ ctrl: true, keys: ['ctrl', 'h'] }),
    'ctrl+h'
  );
});

test('a combo shortcut matches its own category, not the plain-key one', () => {
  const categories: Category[] = [
    { id: 'hippo', shortcutKey: 'h' },
    { id: 'hyena', shortcutKey: 'ctrl+h' },
  ];
  const get = (c: Category) => c.shortcutKey;

  assert.equal(
    findShortcutMatch(keyEvent('h', 'KeyH', { ctrlKey: true }), categories, get)
      ?.id,
    'hyena'
  );
  assert.equal(
    findShortcutMatch(keyEvent('h', 'KeyH'), categories, get)?.id,
    'hippo'
  );
});

test('shortcuts recorded as physical key names match the character pressed', () => {
  const categories: Category[] = [{ id: 'dot', shortcutKey: 'period' }];
  assert.equal(
    findShortcutMatch(keyEvent('.', 'Period'), categories, (c) => c.shortcutKey)
      ?.id,
    'dot'
  );
});

test('a shortcut recorded on one layout matches the same physical key on another', () => {
  const categories: Category[] = [{ id: 'antelope', shortcutKey: 'a' }];
  // AZERTY: the key recorded as KeyA ('a') produces 'q'.
  assert.equal(
    findShortcutMatch(keyEvent('q', 'KeyA'), categories, (c) => c.shortcutKey)
      ?.id,
    'antelope'
  );
});

test('a shortcut stored as a shifted character still matches', () => {
  const categories: Category[] = [{ id: 'fp', shortcutKey: '+' }];
  assert.equal(
    findShortcutMatch(
      keyEvent('+', 'Equal', { shiftKey: true }),
      categories,
      (c) => c.shortcutKey
    )?.id,
    'fp'
  );
});

test('modifier presses no longer trigger an unmodified shortcut', () => {
  const categories: Category[] = [{ id: 'hippo', shortcutKey: 'h' }];
  assert.equal(
    findShortcutMatch(
      keyEvent('h', 'KeyH', { ctrlKey: true }),
      categories,
      (c) => c.shortcutKey
    ),
    undefined
  );
});

test('shortcuts render readably', () => {
  assert.equal(formatShortcutKey('ctrl+h'), 'Ctrl+H');
  assert.equal(formatShortcutKey('period'), '.');
  assert.equal(formatShortcutKey('space'), 'Space');
  assert.equal(formatShortcutKey('shift+8'), 'Shift+8');
  assert.equal(formatShortcutKey(null), '');
});
