import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaletteRows, matchScore } from './paletteRows';
import type { SurveyCategory } from './types';

const cat = (id: string, name: string, set = 's1'): SurveyCategory => ({
  id,
  name,
  annotationSetId: set,
  projectId: 'p',
  color: `#${id}`,
});

test('ranks exact, prefix, word prefix and substring matches', () => {
  assert.equal(matchScore('Kori bustard', ''), 0);
  assert.equal(matchScore('Kori', 'kori'), 0);
  assert.equal(matchScore('Kori bustard', 'kori'), 1);
  assert.equal(matchScore('Kori bustard', 'bus'), 2);
  assert.equal(matchScore('Kori bustard', 'stard'), 3);
  assert.equal(matchScore('Kori bustard', 'zebra'), null);
});

test('merges same-named labels across sets', () => {
  const { present } = buildPaletteRows({
    surveyCategories: [cat('a', 'Zebra'), cat('b', 'Zebra', 's2')],
    query: '',
  });
  assert.equal(present.length, 1);
  assert.deepEqual(present[0].categoryIds, ['a', 'b']);
  assert.equal(present[0].color, '#a');
});

test('names only other surveys use appear once a query is typed', () => {
  const input = {
    surveyCategories: [cat('a', 'Ostrich')],
    otherNames: ['Ostrich', 'Oribi', 'Oribi'],
  };
  assert.deepEqual(buildPaletteRows({ ...input, query: '' }).absent, []);
  const { present, absent } = buildPaletteRows({ ...input, query: 'o' });
  assert.deepEqual(
    present.map((r) => r.name),
    ['Ostrich'],
  );
  assert.deepEqual(
    absent.map((r) => [r.name, r.inSurvey]),
    [['Oribi', false]],
  );
});
