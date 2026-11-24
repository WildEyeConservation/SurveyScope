import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeShortcutKey } from '../utils/hotkeys';
import {
  isSpeciesSearchShortcut,
  SPECIES_SEARCH_SHORTCUTS,
  speciesShortcutLabel,
} from './shortcut';

const key = (over: Partial<Parameters<typeof isSpeciesSearchShortcut>[0]>) => ({
  key: 'k',
  code: 'KeyK',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

test('opens on Ctrl+K and Cmd+K only', () => {
  assert.ok(isSpeciesSearchShortcut(key({ ctrlKey: true })));
  assert.ok(isSpeciesSearchShortcut(key({ metaKey: true })));
  assert.ok(!isSpeciesSearchShortcut(key({})));
  assert.ok(!isSpeciesSearchShortcut(key({ ctrlKey: true, shiftKey: true })));
  assert.ok(!isSpeciesSearchShortcut(key({ ctrlKey: true, altKey: true })));
  assert.ok(!isSpeciesSearchShortcut(key({ ctrlKey: true, metaKey: true })));
  assert.ok(
    !isSpeciesSearchShortcut(key({ ctrlKey: true, key: 'j', code: 'KeyJ' })),
  );
});

test('matches the physical K key on other layouts', () => {
  assert.ok(isSpeciesSearchShortcut(key({ ctrlKey: true, key: 'л' })));
});

test('reserved keys use the label editor form', () => {
  assert.deepEqual(SPECIES_SEARCH_SHORTCUTS.map(normalizeShortcutKey), [
    'ctrl+k',
    'meta+k',
  ]);
});

test('labels the shortcut per platform', () => {
  assert.equal(speciesShortcutLabel('MacIntel'), '⌘K');
  assert.equal(speciesShortcutLabel('Win32'), 'Ctrl K');
});
