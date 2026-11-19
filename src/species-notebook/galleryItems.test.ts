import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeItems, isModelSource, spreadByImage } from './galleryItems';
import type { GalleryItem } from './types';

let n = 0;
function item(over: Partial<GalleryItem> = {}): GalleryItem {
  n++;
  const id = over.id ?? `a${n}`;
  return {
    id,
    x: n,
    y: 0,
    imageId: `img${n}`,
    setId: 's',
    categoryId: 'c',
    projectId: 'p',
    objectId: id,
    source: 'manual',
    reviewed: false,
    createdAt: `2026-01-${String((n % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    ...over,
  };
}

const ids = (items: GalleryItem[]) => items.map((i) => i.id);

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
