import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assignOutsideImages, includeOutsideTransect } from './outside';

test('outside images already in the outside transect need no update', () => {
  const result = assignOutsideImages(
    [
      { id: 'a', transectId: 'outside' },
      { id: 'b', transectId: 'stratum-transect' },
      { id: 'c', transectId: null },
    ],
    'outside'
  );
  assert.deepEqual(Array.from(result.imageToTransect.values()), [
    'outside',
    'outside',
    'outside',
  ]);
  assert.deepEqual(result.fanout, [
    { imageId: 'b', transectId: 'outside' },
    { imageId: 'c', transectId: 'outside' },
  ]);
});

test('the client decides whether the outside transect has work', () => {
  assert.equal(includeOutsideTransect(true, false), true);
  assert.equal(includeOutsideTransect(false, true), false);
  assert.equal(includeOutsideTransect(undefined, true), true);
  assert.equal(includeOutsideTransect(undefined, false), false);
});
