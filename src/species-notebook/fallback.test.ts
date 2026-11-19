import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingCategories, sampleAcrossSurveys } from './fallback';
import type { GalleryItem, SurveyCategory } from './types';

const cat = (id: string, name: string, projectId: string): SurveyCategory => ({
  id,
  name,
  projectId,
  annotationSetId: `${projectId}-set`,
});

test('matches other surveys by exact name only', () => {
  const categories = [
    cat('1', 'Kori bustard', 'here'),
    cat('2', 'Kori bustard', 'other'),
    cat('3', 'kori bustard', 'other'),
    cat('4', 'Kori bustard ', 'third'),
    cat('5', 'Kori bustard', 'third'),
  ];
  assert.deepEqual(
    matchingCategories('Kori bustard', categories, 'here').map((c) => c.id),
    ['2', '5'],
  );
});

function item(id: string, projectId: string, reviewed = false): GalleryItem {
  return {
    id,
    x: 0,
    y: 0,
    imageId: id,
    setId: 's',
    categoryId: 'c',
    projectId,
    objectId: id,
    reviewed,
  };
}

test('samples take turns across surveys, reviewed first, and are marked borrowed', () => {
  const items = [
    item('a1', 'A'),
    item('a2', 'A', true),
    item('a3', 'A'),
    item('b1', 'B'),
  ];
  const sample = sampleAcrossSurveys(items, 3);
  assert.deepEqual(
    sample.map((i) => i.id),
    ['a2', 'b1', 'a1'],
  );
  assert.ok(sample.every((i) => i.borrowed));
});

test('sampling stops when every survey is used up', () => {
  assert.equal(sampleAcrossSurveys([item('a', 'A')], 10).length, 1);
  assert.deepEqual(sampleAcrossSurveys([], 5), []);
});
