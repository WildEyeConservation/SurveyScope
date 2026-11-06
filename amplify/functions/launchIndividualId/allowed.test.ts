import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { allowedTransectIds } from './allowed';

const imageToTransect = new Map([
  ['a', 't1'],
  ['b', 't1'],
  ['c', 't2'],
]);

test('no incomplete set allows every transect', () => {
  assert.equal(allowedTransectIds({}, imageToTransect), null);
});

test('incomplete images allow only their detected transects', () => {
  assert.deepEqual(
    allowedTransectIds(
      { incompleteImageIds: ['b', 'missing'] },
      imageToTransect,
    ),
    new Set(['t1']),
  );
  assert.deepEqual(
    allowedTransectIds({ incompleteImageIds: [] }, imageToTransect),
    new Set(),
  );
});

test('incomplete transect ids pass through', () => {
  assert.deepEqual(
    allowedTransectIds({ incompleteTransectIds: ['t2'] }, imageToTransect),
    new Set(['t2']),
  );
});
