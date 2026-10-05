import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataClient } from '../amplify/shared/data-schema.generated';
import { attachInfoTagsToAnnotations, infoTagIdsFromLinks } from './infoTags';

test('untagged sets strip API relationship loaders before annotations reach map popups', async () => {
  const relationship = async (_options: unknown) => ({ data: [] });
  const annotations = [
    { id: 'a', infoTags: relationship },
    { id: 'b', infoTags: { items: [] } },
    { id: 'c', infoTags: ['stale tag'] },
  ];
  const client = {
    models: {
      InfoTag: {
        infoTagsByAnnotationSetId: async () => ({ data: [] }),
      },
      AnnotationInfoTag: {
        annotationInfoTagsByAnnotationSetId: async () => {
          assert.fail('untagged sets should not fetch annotation links');
        },
      },
    },
  } as unknown as DataClient;

  const result = await attachInfoTagsToAnnotations(
    client,
    annotations,
    'set-1'
  );
  assert.deepEqual(result, [
    { id: 'a', infoTags: undefined },
    { id: 'b', infoTags: undefined },
    { id: 'c', infoTags: undefined },
  ]);
  assert.equal(annotations[0].infoTags, relationship);
});

test('tagged sets resolve sorted names and retain empty arrays for untagged annotations', async () => {
  const client = {
    models: {
      InfoTag: {
        infoTagsByAnnotationSetId: async () => ({
          data: [
            { id: 'z', name: 'Zebra' },
            { id: 'a', name: 'Adult' },
          ],
        }),
      },
      AnnotationInfoTag: {
        annotationInfoTagsByAnnotationSetId: async () => ({
          data: [
            { annotationId: 'tagged', infoTagId: 'z' },
            { annotationId: 'tagged', infoTagId: 'a' },
          ],
        }),
      },
    },
  } as unknown as DataClient;

  const result = await attachInfoTagsToAnnotations(
    client,
    [
      { id: 'tagged', infoTags: async () => ({ data: [] }) },
      { id: 'untagged' },
    ],
    'set-1'
  );
  assert.deepEqual(result, [
    { id: 'tagged', infoTags: ['Adult', 'Zebra'] },
    { id: 'untagged', infoTags: [] },
  ]);
});

test('infoTagIdsFromLinks accepts array and paged link shapes', () => {
  assert.deepEqual(infoTagIdsFromLinks([{ infoTagId: 'a' }]), ['a']);
  assert.deepEqual(infoTagIdsFromLinks({ items: [{ infoTagId: 'b' }] }), ['b']);
  assert.deepEqual(infoTagIdsFromLinks(undefined), []);
  assert.deepEqual(infoTagIdsFromLinks([{ infoTagId: null }]), []);
});
