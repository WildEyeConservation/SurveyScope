import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCategoryIdForSet } from './utils';

const categories = [
  { id: 'job-other', name: 'other', annotationSetId: 'job' },
  { id: 'test-other', name: 'Other', annotationSetId: 'test' },
  { id: 'test-unknown', name: 'Unknown', annotationSetId: 'test' },
];

test('keeps a category already in the target set', () => {
  assert.equal(
    resolveCategoryIdForSet(categories[0], categories, 'job'),
    'job-other',
  );
});

test('matches a same-named category regardless of case', () => {
  assert.equal(
    resolveCategoryIdForSet(categories[0], categories, 'test'),
    'test-other',
  );
});

test('falls back to the target set Unknown when no name matches', () => {
  assert.equal(
    resolveCategoryIdForSet(
      { id: 'job-animal', name: 'Animal', annotationSetId: 'job' },
      categories,
      'test',
    ),
    'test-unknown',
  );
});
