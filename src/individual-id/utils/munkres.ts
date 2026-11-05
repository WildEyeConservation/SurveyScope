import computeMunkres from 'munkres-js';
import type { AnnotationType, ImageType } from '../../schemaTypes';
import type { MatchCandidate, PixelTransform } from '../types';
import { isOov } from './identity';
import { isInOverlap, projectsInside } from './transforms';

export interface BuildCandidatesInput {
  annotationsA: AnnotationType[];
  annotationsB: AnnotationType[];
  imageA: ImageType;
  imageB: ImageType;
  forward: PixelTransform;
  backward: PixelTransform;
  leniency: number;
  categoryFilter?: string | string[];
}

const HARD_FORCE = -1_000_000;
const HARD_FORBID = 1_000_000;

function dist2(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function passesCategory(
  anno: AnnotationType,
  filter?: string | string[],
): boolean {
  if (!filter) return true;
  if (typeof filter === 'string') return anno.categoryId === filter;
  return filter.includes(anno.categoryId);
}

// Prefer existing ObjectIds so identicons stay stable across re-renders.
function makeIdentityKey(a?: AnnotationType, b?: AnnotationType): string {
  return (
    a?.objectId ??
    b?.objectId ??
    a?.id ??
    b?.id ??
    `pair-${crypto.randomUUID()}`
  );
}

function makeCandidateKeys(a?: AnnotationType, b?: AnnotationType) {
  const identityKey = makeIdentityKey(a, b);
  const hasLinkedIdentity = !!a?.objectId || !!b?.objectId;
  return {
    identityKey,
    // Keep unlinked one-sided candidates keyed by their annotation id so the
    // pre-created "new annotation" id can still be focused immediately. Once
    // a chain identity exists, include row ids as a defensive guard against
    // already-corrupt data with duplicate same-image chain members.
    pairKey: hasLinkedIdentity
      ? `${identityKey}::${a?.id ?? 'shadow-a'}::${b?.id ?? 'shadow-b'}`
      : identityKey,
  };
}

export function buildMatchCandidates({
  annotationsA,
  annotationsB,
  imageA,
  imageB,
  forward,
  backward,
  leniency,
  categoryFilter,
}: BuildCandidatesInput): MatchCandidate[] {
  const all_A = annotationsA.filter((a) => passesCategory(a, categoryFilter));
  const all_B = annotationsB.filter((a) => passesCategory(a, categoryFilter));

  // OOV annotations have no on-image position — handled separately at the end.
  const oovA = all_A.filter((a) => isOov(a));
  const oovB = all_B.filter((a) => isOov(a));
  const posAllA = all_A.filter((a) => !isOov(a));
  const posAllB = all_B.filter((a) => !isOov(a));

  // Positioned annotations already chained to an OOV on the other image must
  // stay out of the Munkres matrix — they'd get a phantom shadow on the missing side.
  const chainSet = (list: AnnotationType[]) => {
    const s = new Set<string>();
    for (const o of list) {
      if (o.objectId) s.add(o.objectId);
      s.add(o.id);
    }
    return s;
  };
  const oovChainOnA = chainSet(oovA);
  const oovChainOnB = chainSet(oovB);
  const linkedToOtherOov = (ann: AnnotationType, otherChain: Set<string>) =>
    !!ann.objectId && otherChain.has(ann.objectId);

  const A = posAllA.filter((a) => !linkedToOtherOov(a, oovChainOnB));
  const B = posAllB.filter((b) => !linkedToOtherOov(b, oovChainOnA));

  const candidates: MatchCandidate[] = [];

  const acceptedA = new Set<string>();
  const acceptedB = new Set<string>();
  const byObjectId = (list: AnnotationType[]) => {
    const out = new Map<string, AnnotationType[]>();
    for (const ann of list) {
      if (!ann.objectId) continue;
      const group = out.get(ann.objectId);
      if (group) group.push(ann);
      else out.set(ann.objectId, [ann]);
    }
    return out;
  };

  // Exact one-to-one links are already solved. Keeping them in the Hungarian
  // matrix makes the common "large herd, mostly linked" case pay cubic cost
  // for work that HARD_FORCE would deterministically choose anyway.
  const objectA = byObjectId(A);
  const objectB = byObjectId(B);
  for (const [objectId, annsA] of objectA) {
    const bs = objectB.get(objectId);
    if (!bs || annsA.length !== 1 || bs.length !== 1) continue;
    const a = annsA[0];
    const b = bs[0];
    acceptedA.add(a.id);
    acceptedB.add(b.id);
    const keys = makeCandidateKeys(a, b);
    candidates.push({
      ...keys,
      categoryId: a.categoryId,
      realA: a,
      realB: b,
      posA: { x: a.x, y: a.y },
      posB: { x: b.x, y: b.y },
      isShadowA: false,
      isShadowB: false,
      status: 'accepted',
    });
  }

  const assignA = acceptedA.size ? A.filter((a) => !acceptedA.has(a.id)) : A;
  const assignB = acceptedB.size ? B.filter((b) => !acceptedB.has(b.id)) : B;

  if (assignA.length + assignB.length > 0) {
    // Pad to a square matrix; pad rows/cols represent "leave unmatched" at cost = leniency.
    const N = assignA.length + assignB.length;
    const cost: number[][] = Array.from({ length: N }, () =>
      Array<number>(N).fill(leniency),
    );

    for (let i = 0; i < assignA.length; i++) {
      const a = assignA[i];
      const projected = forward([a.x, a.y]);
      for (let j = 0; j < assignB.length; j++) {
        const b = assignB[j];
        if (a.objectId && b.objectId && a.objectId === b.objectId) {
          cost[i][j] = HARD_FORCE;
          continue;
        }
        // Different objectIds intentionally fall through to the distance cost so a cross-chain match can be proposed (accepting merges the two chains).
        if (a.categoryId !== b.categoryId) {
          cost[i][j] = HARD_FORBID;
          continue;
        }
        cost[i][j] = dist2(
          { x: projected[0], y: projected[1] },
          { x: b.x, y: b.y },
        );
      }
    }

    const assignment = computeMunkres(cost) as [number, number][];

    for (const [ai, bj] of assignment) {
      const a = assignA[ai];
      const b = assignB[bj];

      if (a && b) {
        const keys = makeCandidateKeys(a, b);
        candidates.push({
          ...keys,
          categoryId: a.categoryId,
          realA: a,
          realB: b,
          posA: { x: a.x, y: a.y },
          posB: { x: b.x, y: b.y },
          isShadowA: false,
          isShadowB: false,
          status:
            a.objectId && a.objectId === b.objectId ? 'accepted' : 'pending',
        });
        continue;
      }

      if (a && !b) {
        // Out-of-overlap annotations become `informational` — visible on the map but excluded from completion.
        // Two guards, both required: the polygon test stops a far-away point
        // from extrapolating back to a false "inside", and the forward-
        // projection bounds check stops a chained (reunion) homography whose
        // wrapped footprint quad gives a false polygon "inside" from placing
        // a shadow off the target image.
        const inside =
          isInOverlap(a.x, a.y, backward, imageB.width, imageB.height) &&
          projectsInside(a.x, a.y, forward, imageB.width, imageB.height);
        const keys = makeCandidateKeys(a);
        if (inside) {
          const projected = forward([a.x, a.y]);
          candidates.push({
            ...keys,
            categoryId: a.categoryId,
            realA: a,
            realB: undefined,
            posA: { x: a.x, y: a.y },
            posB: {
              x: Math.round(projected[0]),
              y: Math.round(projected[1]),
            },
            isShadowA: false,
            isShadowB: true,
            status: 'pending',
          });
        } else {
          candidates.push({
            ...keys,
            categoryId: a.categoryId,
            realA: a,
            realB: undefined,
            posA: { x: a.x, y: a.y },
            posB: null,
            isShadowA: false,
            isShadowB: false,
            status: 'pending',
            informational: true,
          });
        }
        continue;
      }

      if (!a && b) {
        const inside =
          isInOverlap(b.x, b.y, forward, imageA.width, imageA.height) &&
          projectsInside(b.x, b.y, backward, imageA.width, imageA.height);
        const keys = makeCandidateKeys(undefined, b);
        if (inside) {
          const projected = backward([b.x, b.y]);
          candidates.push({
            ...keys,
            categoryId: b.categoryId,
            realA: undefined,
            realB: b,
            posA: {
              x: Math.round(projected[0]),
              y: Math.round(projected[1]),
            },
            posB: { x: b.x, y: b.y },
            isShadowA: true,
            isShadowB: false,
            status: 'pending',
          });
        } else {
          candidates.push({
            ...keys,
            categoryId: b.categoryId,
            realA: undefined,
            realB: b,
            posA: null,
            posB: { x: b.x, y: b.y },
            isShadowA: false,
            isShadowB: false,
            status: 'pending',
            informational: true,
          });
        }
        continue;
      }
    }
  }

  const sharesChain = (p: AnnotationType, o: AnnotationType) =>
    (!!p.objectId && (p.objectId === o.objectId || p.objectId === o.id)) ||
    (!!o.objectId && o.objectId === p.id);

  // OOV ↔ partner record. Every OOV in the new model is created via the
  // "Move to OOV" action, so it always has a real partner on the other side
  // (chain-linked via shared objectId). We surface it as an `accepted`
  // candidate so the OovPanel can list it as a record of "this animal is
  // hidden here". Orphan OOVs (no partner on the other side) are silently
  // ignored — they don't drive attention and shouldn't exist in the new
  // model anyway.
  const recordPartneredOov = (o: AnnotationType, side: 'A' | 'B') => {
    const others = side === 'A' ? posAllB : posAllA;
    const partner = others.find((p) => sharesChain(p, o));
    if (!partner) return;
    const keys =
      side === 'A'
        ? makeCandidateKeys(o, partner)
        : makeCandidateKeys(partner, o);
    candidates.push({
      ...keys,
      categoryId: o.categoryId,
      realA: side === 'A' ? o : partner,
      realB: side === 'A' ? partner : o,
      posA: side === 'A' ? null : { x: partner.x, y: partner.y },
      posB: side === 'A' ? { x: partner.x, y: partner.y } : null,
      isShadowA: false,
      isShadowB: false,
      status: 'accepted',
      oovSide: side,
    });
  };
  for (const o of oovA) recordPartneredOov(o, 'A');
  for (const o of oovB) recordPartneredOov(o, 'B');

  return candidates;
}
