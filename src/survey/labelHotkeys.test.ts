import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeShortcutKey } from '../utils/hotkeys';
import {
  APP_RESERVED_SHORTCUTS,
  isBrowserReservedShortcut,
  salientKeys,
  suggestShortcutKey,
  suggestShortcutKeys,
} from './labelHotkeys';

const fill = (names: string[]) =>
  suggestShortcutKeys(names.map((name) => ({ name, shortcutKey: '' })));

test('salient letters: word starts, then consonants, then vowels', () => {
  assert.deepEqual(salientKeys('Roan antelope').slice(0, 4), [
    'r',
    'a',
    'n',
    't',
  ]);
  assert.ok(salientKeys('Elephant carcass 2').includes('2'));
});

test('common species get their first letter', () => {
  assert.equal(suggestShortcutKey('Elephant', []), 'e');
  assert.equal(suggestShortcutKey('  giraffe ', []), 'g');
});

test('a common species falls back to another plain letter of its name', () => {
  assert.equal(suggestShortcutKey('Eland', ['e']), 'l');
});

test('uncommon labels get Shift and their first letter', () => {
  assert.equal(suggestShortcutKey('Elephant carcass', ['e']), 'shift+e');
  assert.equal(suggestShortcutKey('Aardwolf', []), 'shift+a');
});

test('matching ignores case, spacing and punctuation', () => {
  assert.equal(suggestShortcutKey('LESSER-KUDU', []), 'l');
  assert.equal(suggestShortcutKey('Hippo', []), 'h');
});

test('existing keys are compared in canonical form', () => {
  assert.equal(suggestShortcutKey('Elephant carcass', ['Shift+E']), 'shift+c');
});

test('false positive keeps its usual key', () => {
  assert.equal(suggestShortcutKey('False Positive', []), '+');
});

test('no suggestion without a name', () => {
  assert.equal(suggestShortcutKey('  ', []), undefined);
});

test('existing keys are never replaced', () => {
  const keys = suggestShortcutKeys([
    { name: 'Elephant', shortcutKey: 'x' },
    { name: 'Eland', shortcutKey: '' },
  ]);
  assert.deepEqual(keys, ['x', 'e']);
});

test('more common labels claim plain letters first', () => {
  const [carcass, elephant] = fill(['Elephant carcass', 'Elephant']);
  assert.equal(elephant, 'e');
  assert.equal(carcass, 'shift+e');
});

test("a fallback never takes another label's first choice", () => {
  const [, eland, lion] = fill(['Elephant', 'Eland', 'Lion']);
  assert.equal(lion, 'l');
  assert.equal(eland, 'n');
});

test('70 labels all get distinct, safe, plain or Shift keys', () => {
  const names = Array.from({ length: 70 }, (_, i) => `Species ${i}`);
  const keys = fill(names);
  const normalized = keys.map(normalizeShortcutKey);
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(normalized).size, keys.length);
  for (const key of normalized) {
    assert.ok(!APP_RESERVED_SHORTCUTS.includes(key), key);
    assert.ok(!isBrowserReservedShortcut(key), key);
    assert.match(key, /^(shift\+)?[a-z0-9]$/);
  }
});

test('browser-owned shortcuts are recognised', () => {
  for (const key of ['ctrl+w', 'Ctrl+T', 'shift+ctrl+n', 'ctrl+3', 'alt+f4'])
    assert.ok(isBrowserReservedShortcut(key), key);
  for (const key of ['ctrl+h', 'shift+w', 'w'])
    assert.ok(!isBrowserReservedShortcut(key), key);
});

test('suggestions skip keys the app already binds', () => {
  const taken = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');
  const key = suggestShortcutKey('Elephant', [
    ...taken,
    ...taken.map((k) => `shift+${k}`),
  ]);
  assert.equal(key, 'ctrl+b');
});
