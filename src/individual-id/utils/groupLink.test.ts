import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AnnotationType } from '../../schemaTypes';
import type { MatchCandidate } from '../types';
import {
  herdSpares,
  matchSelection,
  proposalLassos,
  selectHerd,
  updateHerdProposals,
  type Lasso,
} from './groupLink';

const ann = (
  id: string,
  imageId: string,
  x: number,
  y: number,
  objectId: string | null = null,
) => ({ id, imageId, x, y, objectId }) as unknown as AnnotationType;

const cand = (
  realA: AnnotationType | undefined,
  realB: AnnotationType | undefined,
  status: 'pending' | 'accepted' = 'pending',
) => ({ realA, realB, status }) as unknown as MatchCandidate;

const box = (x0: number, y0: number, x1: number, y1: number): Lasso => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

test('existing links are kept: inside both lassos they anchor, otherwise they are left out', () => {
  const linkedA = ann('la', 'A', 10, 10, 'la');
  const linkedB = ann('lb', 'B', 60, 10, 'la');
  const halfA = ann('ha', 'A', 20, 20, 'ha');
  const halfB = ann('hb', 'B', 900, 900, 'ha');
  const a1 = ann('a1', 'A', 30, 30);
  const b1 = ann('b1', 'B', 80, 30);
  const outside = ann('a2', 'A', 500, 500);
  const sel = selectHerd(
    [
      cand(linkedA, linkedB, 'accepted'),
      cand(halfA, halfB, 'accepted'),
      cand(a1, b1),
      cand(outside, undefined),
    ],
    box(0, 0, 100, 100),
    box(0, 0, 100, 100),
  );
  assert.deepEqual(
    sel.anchors.map(([a, b]) => [a.id, b.id]),
    [['la', 'lb']],
  );
  assert.deepEqual(
    sel.freeA.map((a) => a.id),
    ['a1'],
  );
  assert.deepEqual(
    sel.freeB.map((b) => b.id),
    ['b1'],
  );
  const pairs = matchSelection(sel, ([x, y]) => [x + 50, y]);
  assert.deepEqual(
    pairs.map(([a, b]) => [a.id, b.id]),
    [['a1', 'b1']],
  );
});

test('proposal updates replace overlapping pairs, drop one, or discard all', () => {
  const lassos: [Lasso, Lasso] = [box(0, 0, 1, 1), box(0, 0, 1, 1)];
  const first = updateHerdProposals(undefined, {
    pairs: [
      ['a1', 'b1', false],
      ['a2', 'b2', true],
    ],
    lassos,
  });
  const second = updateHerdProposals(first, {
    pairs: [['a3', 'b2', false]],
    lassos,
  });
  assert.deepEqual(second?.pairs, [
    ['a1', 'b1', false],
    ['a3', 'b2', false],
  ]);
  const dropped = updateHerdProposals(second, { drop: 'a1' });
  assert.deepEqual(dropped?.pairs, [['a3', 'b2', false]]);
  assert.equal(updateHerdProposals(dropped, { drop: 'a3' }), undefined);
  assert.equal(updateHerdProposals(second, null), undefined);
});

test('each lassoed herd is remembered once, and a redrawn lasso replaces the old one', () => {
  const herd1: [Lasso, Lasso] = [box(0, 0, 1, 1), box(0, 0, 1, 1)];
  const herd2: [Lasso, Lasso] = [box(5, 5, 6, 6), box(5, 5, 6, 6)];
  const one = updateHerdProposals(undefined, {
    pairs: [['a1', 'b1', false]],
    lassos: herd1,
  });
  const two = updateHerdProposals(one, {
    pairs: [['a2', 'b2', false]],
    lassos: herd2,
  });
  const repaired = updateHerdProposals(two, {
    pairs: [['a1', 'b1', false]],
    lassos: herd1,
  });
  assert.deepEqual(proposalLassos(repaired), [herd2, herd1]);
  const redrawn: [Lasso, Lasso] = [box(0, 0, 2, 2), box(0, 0, 2, 2)];
  const after = updateHerdProposals(repaired, {
    pairs: [['a1', 'b1', false]],
    lassos: redrawn,
  });
  assert.deepEqual(proposalLassos(after), [herd2, redrawn]);
  assert.equal(after?.pairs.length, 2);
});

test('spares are counted once when a smaller lasso overlaps an earlier one', () => {
  const a = [ann('a1', 'A', 1, 1), ann('a2', 'A', 5, 5), ann('a3', 'A', 6, 6)];
  const b = [ann('b1', 'B', 1, 1), ann('b2', 'B', 5, 5)];
  const proposed = (x: AnnotationType, y: AnnotationType) =>
    ({ ...cand(x, y), herdProposed: true }) as MatchCandidate;
  const candidates = [
    proposed(a[0], b[0]),
    proposed(a[1], b[1]),
    cand(a[2], undefined),
  ];
  const big: [Lasso, Lasso] = [box(0, 0, 10, 10), box(0, 0, 10, 10)];
  const small: [Lasso, Lasso] = [box(4, 4, 10, 10), box(4, 4, 10, 10)];
  assert.deepEqual(herdSpares(candidates, [big, small]), { a: 1, b: 0 });
  // A dropped proposal goes back to an ordinary Munkres pair: still not spare.
  const dropped = [cand(a[0], b[0]), ...candidates.slice(1)];
  assert.deepEqual(herdSpares(dropped, [big]), { a: 1, b: 0 });
});
