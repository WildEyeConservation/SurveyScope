import assert from 'node:assert/strict';
import test from 'node:test';
import { infoTagIdsFromLinks } from './infoTags';

test('infoTagIdsFromLinks accepts array and paged link shapes', () => {
  assert.deepEqual(infoTagIdsFromLinks([{ infoTagId: 'a' }]), ['a']);
  assert.deepEqual(infoTagIdsFromLinks({ items: [{ infoTagId: 'b' }] }), ['b']);
  assert.deepEqual(infoTagIdsFromLinks(undefined), []);
  assert.deepEqual(infoTagIdsFromLinks([{ infoTagId: null }]), []);
});
