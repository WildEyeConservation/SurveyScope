import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arrangeItems,
  cropTiles,
  cropWindow,
  isModelSource,
  matchingCategories,
  sampleAcrossSurveys,
  spreadByImage,
  type NotebookCandidate,
} from './speciesNotebook';

let n = 0;
function item(over: Partial<NotebookCandidate> = {}): NotebookCandidate {
  n++;
  const id = over.id ?? `a${n}`;
  return {
    id,
    imageId: `img${n}`,
    projectId: 'p',
    objectId: id,
    source: 'manual',
    reviewed: false,
    createdAt: `2026-01-${String((n % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    ...over,
  };
}

const ids = (items: NotebookCandidate[]) => items.map((i) => i.id);

test('tells model sources from people', () => {
  assert.equal(isModelSource('manual'), false);
  assert.equal(isModelSource('manual-false-negative'), false);
  assert.equal(isModelSource('individual-id'), false);
  assert.equal(isModelSource('scoutbotv3'), true);
  assert.equal(isModelSource('owl-d-v1'), true);
  assert.equal(isModelSource(null), false);
});

test('reviewed first puts reviewed primaries ahead, newest within a tier', () => {
  const old = item({ id: 'old', createdAt: '2026-01-01T00:00:00Z' });
  const fresh = item({ id: 'fresh', createdAt: '2026-03-01T00:00:00Z' });
  const reviewed = item({
    id: 'rev',
    reviewed: true,
    createdAt: '2025-01-01T00:00:00Z',
  });
  const secondary = item({ id: 'sec', objectId: 'rev', reviewed: true });
  assert.deepEqual(ids(arrangeItems([old, secondary, fresh, reviewed])), [
    'rev',
    'sec',
    'fresh',
    'old',
  ]);
});

test('keeps every annotation, people and model alike', () => {
  const primary = item({ id: 'p1' });
  const secondary = item({ id: 's1', objectId: 'p1' });
  const unlinked = item({ id: 'u1', objectId: null });
  const model = item({ id: 'm1', source: 'mad-v2' });
  assert.deepEqual(
    ids(arrangeItems([primary, secondary, unlinked, model])).sort(),
    ['m1', 'p1', 's1', 'u1'],
  );
});

test('spreads one image across the grid within a tier', () => {
  const herd = [1, 2, 3].map((i) => ({ id: `h${i}`, imageId: 'herd' }));
  const other = [
    { id: 'o1', imageId: 'x' },
    { id: 'o2', imageId: 'y' },
  ];
  const spread = spreadByImage([...herd, ...other], () => 0);
  assert.deepEqual(
    spread.map((i) => i.id),
    ['h1', 'o1', 'o2', 'h2', 'h3'],
  );
});

test('spreading never moves an item across tiers', () => {
  const items = [
    { id: 'r1', imageId: 'a', tier: 0 },
    { id: 'r2', imageId: 'a', tier: 0 },
    { id: 'u1', imageId: 'b', tier: 1 },
  ];
  assert.deepEqual(
    spreadByImage(items, (i) => i.tier).map((i) => i.id),
    ['r1', 'r2', 'u1'],
  );
});

test('matches other surveys by exact name only', () => {
  const cat = (id: string, name: string, projectId: string) => ({
    id,
    name,
    projectId,
  });
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

test('samples take turns across surveys, reviewed first', () => {
  const at = (id: string, projectId: string, reviewed = false) =>
    item({ id, projectId, imageId: id, reviewed });
  const sample = sampleAcrossSurveys(
    [at('a1', 'A'), at('a2', 'A', true), at('a3', 'A'), at('b1', 'B')],
    3,
  );
  assert.deepEqual(ids(sample).slice(0, 2), ['a2', 'b1']);
  assert.equal(sample.length, 3);
});

test('sampling stops when every survey is used up', () => {
  assert.equal(sampleAcrossSurveys([item({ projectId: 'A' })], 10).length, 1);
  assert.deepEqual(sampleAcrossSurveys([], 5), []);
});

test('the crop is centred on the point and stays inside the image', () => {
  const image = { width: 4000, height: 3000 };
  assert.deepEqual(cropWindow({ x: 2000, y: 1500 }, image), {
    left: 1744,
    top: 1244,
    width: 512,
    height: 512,
  });
  assert.deepEqual(cropWindow({ x: 10, y: 2990 }, image), {
    left: 0,
    top: 2488,
    width: 512,
    height: 512,
  });
  assert.deepEqual(cropWindow({ x: 50, y: 50 }, { width: 300, height: 200 }), {
    left: 0,
    top: 0,
    width: 300,
    height: 200,
  });
});

test('crop tiles are the full-resolution tiles under the window', () => {
  const tiles = cropTiles(
    { left: 1744, top: 1244, width: 512, height: 512 },
    { tileSize: 256, maxZoom: 4 },
  );
  assert.deepEqual(
    tiles.map((t) => `${t.z}/${t.row}/${t.col}`),
    [
      '4/4/6', '4/4/7', '4/4/8',
      '4/5/6', '4/5/7', '4/5/8',
      '4/6/6', '4/6/7', '4/6/8',
    ],
  );
  assert.equal(
    cropTiles({ left: 0, top: 0, width: 512, height: 512 }, {
      tileSize: 256,
      maxZoom: 4,
    }).length,
    4,
  );
});
