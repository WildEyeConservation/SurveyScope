import assert from 'node:assert/strict';
import test from 'node:test';
import { mapFromEntries } from './persistedMap';

const EMPTY = new Map<string, string[]>();

test('entries rebuild into a working Map', () => {
  const result = mapFromEntries(
    [
      ['annoA', ['Calf']],
      ['annoB', ['Tagged', 'Collared']],
    ],
    EMPTY
  );
  assert.equal(typeof result.get, 'function');
  assert.deepEqual(result.get('annoA'), ['Calf']);
  assert.deepEqual(result.get('annoB'), ['Tagged', 'Collared']);
  assert.equal(result.size, 2);
});

test('a Map survives the persister round-trip once stored as entries', () => {
  const original = new Map<string, string[]>([['annoA', ['Calf']]]);
  // What persistQueryClient does to the cached value.
  const persisted = JSON.parse(JSON.stringify(Array.from(original)));
  const restored = mapFromEntries(persisted, EMPTY);
  assert.deepEqual(restored.get('annoA'), ['Calf']);
  // The regression this guards: storing the Map itself loses everything.
  assert.deepEqual(JSON.parse(JSON.stringify(original)), {});
});

test('a cache entry in the old Map shape degrades instead of throwing', () => {
  // A Map persisted before this change deserializes as {}, and new Map({})
  // throws "object is not iterable".
  const legacy = JSON.parse(JSON.stringify(new Map([['annoA', ['Calf']]])));
  assert.deepEqual(legacy, {});
  assert.doesNotThrow(() => mapFromEntries(legacy, EMPTY));
  assert.equal(mapFromEntries(legacy, EMPTY), EMPTY);
});

test('missing data returns the shared empty value', () => {
  assert.equal(mapFromEntries(undefined, EMPTY), EMPTY);
  // Identity is preserved so consumers memoising on the result do not churn.
  assert.equal(mapFromEntries(undefined, EMPTY), mapFromEntries(undefined, EMPTY));
});
