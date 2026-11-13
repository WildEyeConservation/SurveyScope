import type { AnnotationType } from '../../schemaTypes';
import type { MatchCandidate, PixelTransform } from '../types';
import { matchHerd, type HerdPoint } from './herdMatch';
import { pointInPolygon } from './transforms';

export type Lasso = [number, number][];

export interface HerdSelection {
  freeA: AnnotationType[];
  freeB: AnnotationType[];
  anchors: [AnnotationType, AnnotationType][];
}

export function selectHerd(
  candidates: MatchCandidate[],
  lassoA: Lasso,
  lassoB: Lasso,
): HerdSelection {
  const inA = (a: AnnotationType) => pointInPolygon(a.x, a.y, lassoA);
  const inB = (b: AnnotationType) => pointInPolygon(b.x, b.y, lassoB);
  const sel: HerdSelection = { freeA: [], freeB: [], anchors: [] };
  for (const c of candidates) {
    if (c.oovSide) continue;
    const { realA: a, realB: b } = c;
    if (c.status === 'accepted') {
      if (a && b && inA(a) && inB(b)) sel.anchors.push([a, b]);
      continue;
    }
    if (a && inA(a)) sel.freeA.push(a);
    if (b && inB(b)) sel.freeB.push(b);
  }
  return sel;
}

// Existing links never steer the pairing.
export function matchSelection(
  sel: HerdSelection,
  forward: PixelTransform,
): [AnnotationType, AnnotationType, boolean][] {
  const toB = (a: AnnotationType): HerdPoint => {
    const [x, y] = forward([a.x, a.y]);
    return Number.isFinite(x) && Number.isFinite(y)
      ? { id: a.id, x, y }
      : { id: a.id, x: a.x, y: a.y };
  };
  const pairs = matchHerd(sel.freeA.map(toB), sel.freeB);
  const aById = new Map(sel.freeA.map((a) => [a.id, a]));
  const bById = new Map(sel.freeB.map((b) => [b.id, b]));
  return pairs.map(([a, b, uncertain]) => [
    aById.get(a)!,
    bById.get(b)!,
    uncertain,
  ]);
}

export type ProposedPair = [string, string, boolean];

export interface HerdProposals {
  pairs: ProposedPair[];
  // The lasso batch that proposed each pair; a batch with no pairs left is forgotten.
  owners: [Lasso, Lasso][];
  version: number;
}

export type HerdProposalUpdate =
  { pairs: ProposedPair[]; lassos: [Lasso, Lasso] } | { drop: string } | null;

export function updateHerdProposals(
  prev: HerdProposals | undefined,
  update: HerdProposalUpdate,
): HerdProposals | undefined {
  if (!update) return undefined;
  const old = (prev?.pairs ?? []).map((pair, i) => ({
    pair,
    owner: prev!.owners[i],
  }));
  let next;
  if ('drop' in update) {
    next = old.filter(({ pair: [a] }) => a !== update.drop);
  } else {
    const taken = new Set(update.pairs.flatMap(([a, b]) => [a, b]));
    next = [
      ...old.filter(({ pair: [a, b] }) => !taken.has(a) && !taken.has(b)),
      ...update.pairs.map((pair) => ({ pair, owner: update.lassos })),
    ];
  }
  if (!next.length) return undefined;
  return {
    pairs: next.map(({ pair }) => pair),
    owners: next.map(({ owner }) => owner),
    version: (prev?.version ?? 0) + 1,
  };
}

export function proposalLassos(p: HerdProposals | undefined): [Lasso, Lasso][] {
  return [...new Set(p?.owners ?? [])];
}

export function herdSpares(
  candidates: MatchCandidate[],
  lassos: [Lasso, Lasso][],
): { a: number; b: number } {
  const a = new Set<string>();
  const b = new Set<string>();
  for (const [lassoA, lassoB] of lassos) {
    const sel = selectHerd(candidates, lassoA, lassoB);
    sel.freeA.forEach((x) => a.add(x.id));
    sel.freeB.forEach((x) => b.add(x.id));
  }
  for (const c of candidates) {
    if (c.status === 'accepted' || !c.realA || !c.realB) continue;
    a.delete(c.realA.id);
    b.delete(c.realB.id);
  }
  return { a: a.size, b: b.size };
}
