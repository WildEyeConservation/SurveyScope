import assert from 'node:assert/strict';
import test from 'node:test';
import { countTestAnnotations, countTestKey } from './testScoring';

const location = { x: 100, y: 100, width: 50, height: 50 };
const names = { a: 'oryx', b: 'kudu' };
const none = new Set<string>();

test('counts annotations inside the test location by label', () => {
  assert.deepEqual(
    countTestAnnotations(
      {
        local: [{ id: '1', x: 100, y: 100, categoryId: 'a' }],
        stored: [
          { id: '2', x: 120, y: 80, categoryId: 'a' },
          { id: '3', x: 90, y: 110, categoryId: 'b' },
        ],
        deletedIds: none,
      },
      location,
      names,
    ),
    { oryx: 2, kudu: 1 },
  );
});

test('ignores annotations outside the test location', () => {
  assert.deepEqual(
    countTestAnnotations(
      {
        local: [],
        stored: [{ id: '1', x: 200, y: 100, categoryId: 'a' }],
        deletedIds: none,
      },
      location,
      names,
    ),
    {},
  );
});

test('prefers the local copy of an annotation over the stored one', () => {
  assert.deepEqual(
    countTestAnnotations(
      {
        local: [{ id: '1', x: 300, y: 300, categoryId: 'b' }],
        stored: [
          { id: '1', x: 100, y: 100, categoryId: 'a' },
          { id: '2', x: 105, y: 100, categoryId: 'a' },
        ],
        deletedIds: none,
      },
      location,
      names,
    ),
    { oryx: 1 },
  );
});

test('skips a stored annotation deleted locally', () => {
  assert.deepEqual(
    countTestAnnotations(
      {
        local: [{ id: '2', x: 105, y: 100, categoryId: 'a' }],
        stored: [
          { id: '1', x: 100, y: 100, categoryId: 'a' },
          { id: '2', x: 105, y: 100, categoryId: 'a' },
        ],
        deletedIds: new Set(['1']),
      },
      location,
      names,
    ),
    { oryx: 1 },
  );
});

test('recomputes the key from source annotations inside the box', () => {
  const oryx = { name: 'Oryx' };
  const kudu = { name: 'Kudu' };
  assert.deepEqual(
    countTestKey(
      [
        { x: 100, y: 100, categoryId: 'a', category: oryx },
        { x: 125, y: 75, categoryId: 'a', category: oryx },
        { x: 80, y: 110, categoryId: 'b', category: kudu },
        { x: 126, y: 100, categoryId: 'b', category: kudu },
      ],
      location,
    ),
    [
      { categoryId: 'a', category: { name: 'Oryx' }, count: 2 },
      { categoryId: 'b', category: { name: 'Kudu' }, count: 1 },
    ],
  );
});

test('an empty box has an empty key', () => {
  assert.deepEqual(
    countTestKey(
      [{ x: 300, y: 300, categoryId: 'a', category: { name: 'Oryx' } }],
      location,
    ),
    [],
  );
});
