import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { detectTransectsById } from '../../../amplify/functions/shared/detectTransects';
import {
  groupLaunchImages,
  launchSelection,
  OUTSIDE_GROUP,
} from './launchGroups';

const flight = [
  { id: 'a', timestamp: 0, cameraId: 'c1' },
  { id: 'b', timestamp: 1, cameraId: 'c1' },
  { id: 'c', timestamp: 100, cameraId: 'c1' },
  { id: 'd', timestamp: 101, cameraId: 'c1' },
  { id: 'x', timestamp: 50, boundaryStatus: 'outside' as const },
];

function sets(groups: Map<string, Set<string>>) {
  return [...groups.values()].map((s) => [...s].sort()).sort();
}

test('without transects, on-effort images are grouped as the lambda detects them', () => {
  const { groups, transectsExist } = groupLaunchImages(flight);
  assert.equal(transectsExist, false);
  assert.deepEqual(sets(groups), [['a', 'b'], ['c', 'd'], ['x']]);
  assert.deepEqual(groups.get(OUTSIDE_GROUP), new Set(['x']));
});

test('existing transects are used as they are', () => {
  const { groups, transectsExist } = groupLaunchImages([
    { id: 'a', transectId: 't1' },
    { id: 'b', transectId: null },
    { id: 'x', transectId: 't1', boundaryStatus: 'excluded' },
  ]);
  assert.equal(transectsExist, true);
  assert.deepEqual(groups.get('t1'), new Set(['a']));
  assert.deepEqual(groups.get(OUTSIDE_GROUP), new Set(['x']));
  assert.equal(groups.size, 2);
});

test('detection ignores input order', () => {
  const p = { id: 'p', timestamp: 0, latitude: 0, longitude: 0 };
  const q = { id: 'q', timestamp: 0, latitude: 0, longitude: 0.002 };
  const r = { id: 'r', timestamp: 0, latitude: 0, longitude: 0.004 };
  const grouping = (images: (typeof p)[]) => {
    const groups = new Map<number, string[]>();
    for (const a of detectTransectsById(images)) {
      groups.set(a.transectIndex, [
        ...(groups.get(a.transectIndex) ?? []),
        a.id,
      ]);
    }
    return [...groups.values()].map((g) => g.sort().join()).sort();
  };
  assert.deepEqual(grouping([p, r, q]), grouping([p, q, r]));
});

test('detected groups are sent as their annotated images', () => {
  const { groups } = groupLaunchImages(flight);
  const groupOf = (id: string) =>
    [...groups].find(([, ids]) => ids.has(id))![0];
  assert.deepEqual(
    launchSelection(
      [groupOf('c'), OUTSIDE_GROUP],
      groups,
      ['a', 'd', 'x'],
      false,
    ),
    { incompleteImageIds: ['d'], includeOutside: true },
  );
});

test('existing transects are sent by id', () => {
  const { groups } = groupLaunchImages([{ id: 'a', transectId: 't1' }]);
  assert.deepEqual(launchSelection(['t1'], groups, ['a'], true), {
    incompleteTransectIds: ['t1'],
    includeOutside: false,
  });
});
