import assert from 'node:assert/strict';
import test from 'node:test';
import { Lru } from './lru';

test('evicts the least recently used entry past the cap', () => {
  const evicted: string[] = [];
  const lru = new Lru<number>(2, (key) => evicted.push(key));
  lru.set('a', 1);
  lru.set('b', 2);
  lru.get('a');
  lru.set('c', 3);
  assert.deepEqual(evicted, ['b']);
  assert.equal(lru.peek('a'), 1);
  assert.equal(lru.peek('b'), undefined);
});

test('keeps pinned entries until they are unpinned', () => {
  const evicted: string[] = [];
  const lru = new Lru<number>(1, (key) => evicted.push(key));
  lru.set('a', 1);
  lru.pin('a');
  lru.set('b', 2);
  assert.deepEqual(evicted, []);
  assert.equal(lru.size, 2);
  lru.unpin('a');
  assert.deepEqual(evicted, ['a']);
});

test('pins are counted per holder', () => {
  const lru = new Lru<number>(1);
  lru.set('a', 1);
  lru.pin('a');
  lru.pin('a');
  lru.set('b', 2);
  lru.unpin('a');
  assert.equal(lru.peek('a'), 1);
  lru.unpin('a');
  assert.equal(lru.peek('a'), undefined);
});

test('replacing a value releases the old one', () => {
  const evicted: number[] = [];
  const lru = new Lru<number>(5, (_, value) => evicted.push(value));
  lru.set('a', 1);
  lru.set('a', 2);
  lru.delete('a');
  assert.deepEqual(evicted, [1, 2]);
});

test('clear releases everything', () => {
  const evicted: string[] = [];
  const lru = new Lru<number>(5, (key) => evicted.push(key));
  lru.set('a', 1);
  lru.set('b', 2);
  lru.clear();
  assert.deepEqual(evicted, ['a', 'b']);
  assert.equal(lru.size, 0);
});
