import assert from 'node:assert/strict';
import test from 'node:test';
import { exploreUrl, readExploreParams } from './exploreLink';

test('round-trips an Explore target through the URL', () => {
  const url = exploreUrl({
    projectId: 'p1',
    imageId: 'i1',
    annotationSetId: 's1',
    categoryId: 'c1',
  });
  assert.equal(url, '/surveys/p1/review?image=i1&set=s1&label=c1');
  assert.deepEqual(readExploreParams('p1', url.split('?')[1]), {
    projectId: 'p1',
    imageId: 'i1',
    annotationSetId: 's1',
    categoryId: 'c1',
  });
});

test('ignores a URL with nothing to show', () => {
  assert.equal(readExploreParams('p1', '?set=s1'), null);
  assert.equal(readExploreParams('p1', ''), null);
  assert.equal(exploreUrl({ projectId: 'p1' }), '/surveys/p1/review');
});
