import assert from 'node:assert/strict';
import test from 'node:test';
import { insertVisit, keepCurrent } from './reviewImageList';

test('returns the list unchanged when the current image still matches', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(keepCurrent(ids, ['a', 'b', 'c'], 'b'), ids);
});

test('keeps a dropped current image at its previous position', () => {
  assert.deepEqual(keepCurrent(['a', 'c'], ['a', 'b', 'c'], 'b'), [
    'a',
    'b',
    'c',
  ]);
});

test('keeps a dropped first image first', () => {
  assert.deepEqual(keepCurrent(['b', 'c'], ['a', 'b', 'c'], 'a'), [
    'a',
    'b',
    'c',
  ]);
});

test('skips earlier images that were dropped too', () => {
  assert.deepEqual(keepCurrent(['a', 'd'], ['a', 'b', 'c', 'd'], 'c'), [
    'a',
    'c',
    'd',
  ]);
});

test('does not add an image that was not listed before', () => {
  const ids = ['a', 'c'];
  assert.equal(keepCurrent(ids, ['a', 'c'], 'b'), ids);
  assert.equal(keepCurrent(ids, ['a', 'b', 'c'], null), ids);
});

test('lists a visited image right after the one it was opened from', () => {
  assert.deepEqual(insertVisit(['a', 'b', 'c'], ['a', 'b', 'c'], 'x', 'b'), [
    'a',
    'b',
    'x',
    'c',
  ]);
});

test('places a visit where its origin was when the origin left the list', () => {
  assert.deepEqual(insertVisit(['a', 'c'], ['a', 'b', 'c'], 'x', 'b'), [
    'a',
    'x',
    'c',
  ]);
});

test('puts a visit first when its origin is unknown', () => {
  assert.deepEqual(insertVisit(['a', 'b'], ['a', 'b'], 'x', null), [
    'x',
    'a',
    'b',
  ]);
});

test('leaves the list alone when the visited image is already listed', () => {
  const ids = ['a', 'b'];
  assert.equal(insertVisit(ids, ids, 'b', 'a'), ids);
});
