import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMissingRow,
  withRowReinstated,
  withRowRestored,
  withoutRow,
} from './optimisticCache';

type Row = { id: string; categoryId?: string };
const byId = (row: Row) => row.id;

test('a null row counts as a failed write even with no errors array', () => {
  // What AppSync returns when it rejects a write outright.
  assert.equal(isMissingRow({ data: null }), true);
  assert.equal(isMissingRow({ data: undefined }), true);
  assert.equal(isMissingRow(undefined), true);
  assert.equal(isMissingRow(null), true);
  // A real write comes back with the persisted row.
  assert.equal(isMissingRow({ data: { id: 'a' } }), false);
});

test('rolling back a failed create keeps rows that landed while it was in flight', () => {
  // The regression this replaces: mutation A snapshots [] before B and C exist,
  // then fails and restores that snapshot, wiping two persisted annotations.
  const a: Row = { id: 'a' };
  const b: Row = { id: 'b' };
  const c: Row = { id: 'c' };
  const cacheWhenAFails = [a, b, c];

  assert.deepEqual(withoutRow(cacheWhenAFails, a, byId), [b, c]);
});

test('rolling back a failed create removes only its own row', () => {
  const rows: Row[] = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(withoutRow(rows, { id: 'b' }, byId), [{ id: 'a' }]);
  // A row that is already gone is not an error.
  assert.deepEqual(withoutRow(rows, { id: 'zzz' }, byId), rows);
});

test('rolling back a failed update restores that row and leaves others alone', () => {
  const previousItems: Row[] = [
    { id: 'a', categoryId: 'waterbuck' },
    { id: 'b', categoryId: 'buffalo' },
  ];
  const rows: Row[] = [
    { id: 'a', categoryId: 'relabelled' },
    { id: 'b', categoryId: 'buffalo' },
    { id: 'c', categoryId: 'created-since' },
  ];

  const result = withRowRestored(rows, { id: 'a' }, previousItems, byId);

  assert.deepEqual(result, [
    { id: 'a', categoryId: 'waterbuck' },
    { id: 'b', categoryId: 'buffalo' },
    // Still present: a snapshot rollback would have dropped it.
    { id: 'c', categoryId: 'created-since' },
  ]);
});

test('an update rollback with no snapshot leaves the cache untouched', () => {
  const rows: Row[] = [{ id: 'a', categoryId: 'x' }];
  assert.deepEqual(withRowRestored(rows, { id: 'a' }, undefined, byId), rows);
});

test('rolling back a failed delete puts the row back exactly once', () => {
  const previousItems: Row[] = [{ id: 'a' }, { id: 'b' }];
  const rows: Row[] = [{ id: 'b' }, { id: 'c' }];

  const result = withRowReinstated(rows, { id: 'a' }, previousItems, byId);
  assert.deepEqual(result, [{ id: 'b' }, { id: 'c' }, { id: 'a' }]);

  // If a subscription already put it back, don't duplicate it.
  assert.deepEqual(
    withRowReinstated(result, { id: 'a' }, previousItems, byId),
    result
  );
});

test('transforms never mutate the array they are given', () => {
  const rows: Row[] = [{ id: 'a' }, { id: 'b' }];
  const snapshot = [...rows];
  withoutRow(rows, { id: 'a' }, byId);
  withRowRestored(rows, { id: 'a' }, [{ id: 'a', categoryId: 'x' }], byId);
  withRowReinstated(rows, { id: 'z' }, [{ id: 'z' }], byId);
  assert.deepEqual(rows, snapshot);
});

test('composite keys are honoured instead of assuming an id field', () => {
  type Link = { orgId: string; userId: string };
  const key = (link: Link) => `${link.orgId}:${link.userId}`;
  const rows: Link[] = [
    { orgId: 'o1', userId: 'u1' },
    { orgId: 'o1', userId: 'u2' },
  ];
  assert.deepEqual(withoutRow(rows, { orgId: 'o1', userId: 'u1' }, key), [
    { orgId: 'o1', userId: 'u2' },
  ]);
});
