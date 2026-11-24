import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAliasedQuery, chunk } from './aliasedQuery';

test('builds one query with aliased fields and scoped variables', () => {
  const { query, variables } = buildAliasedQuery('Batch', [
    {
      alias: 'a0',
      field: 'getImage',
      args: { id: { type: 'ID!', value: 'img-1' } },
      selection: 'id width',
    },
    {
      alias: 'a1',
      field: 'imagesByimageId',
      args: {
        imageId: { type: 'ID!', value: 'img-1' },
        nextToken: { type: 'String', value: null },
      },
      selection: 'items { key }',
    },
  ]);
  assert.equal(
    query,
    'query Batch($a0_id: ID!, $a1_imageId: ID!) {\n  a0: getImage(id: $a0_id) { id width }\n  a1: imagesByimageId(imageId: $a1_imageId) { items { key } }\n}',
  );
  assert.deepEqual(variables, { a0_id: 'img-1', a1_imageId: 'img-1' });
});

test('chunks into fixed-size groups', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});
