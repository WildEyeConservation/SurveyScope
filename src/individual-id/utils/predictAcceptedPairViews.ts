import type { AnnotationType, ImageType } from '../../schemaTypes';
import type {
  MatchCandidate,
  NeighbourPairWithMeta,
  PairCompletionState,
} from '../types';
import { findSameImageAnnotationConflicts } from './chains';
import { evaluatePairCompletion } from './completion';
import { isOlder } from './imageAge';
import { buildMatchCandidates } from './munkres';

interface PairView {
  candidates: MatchCandidate[];
  completion: PairCompletionState;
  pairKeyStr: string;
}
interface Input {
  pairs: readonly NeighbourPairWithMeta[];
  views: PairView[];
  currentIndex: number;
  annotations: readonly AnnotationType[];
  imagesById: Record<string, ImageType>;
  leniency: number;
  categoryId: string | undefined;
  mergeCandidates: (
    key: string,
    candidates: MatchCandidate[]
  ) => MatchCandidate[];
}

/** Pair views as if the current proposals were accepted. Pure; nothing is written. */
export function predictAcceptedPairViews({
  pairs,
  views,
  currentIndex,
  annotations,
  imagesById,
  leniency,
  categoryId,
  mergeCandidates,
}: Input): PairView[] {
  const current = pairs[currentIndex];
  const candidates = views[currentIndex]?.candidates.filter(
    (candidate) =>
      candidate.status === 'pending' &&
      !candidate.informational &&
      !candidate.oovSide
  );
  if (!current || !candidates?.length) return views;
  const preview = new Map(
    annotations.map((annotation) => [annotation.id, annotation])
  );
  const changedImages = new Set<string>();
  for (const candidate of candidates) {
    const actors: AnnotationType[] = [];
    for (const side of ['A', 'B'] as const) {
      const real = side === 'A' ? candidate.realA : candidate.realB;
      const position = side === 'A' ? candidate.posA : candidate.posB;
      const existing = real ? preview.get(real.id) ?? real : undefined;
      if (existing) {
        actors.push(
          position
            ? {
                ...existing,
                x: Math.round(position.x),
                y: Math.round(position.y),
              }
            : existing
        );
      } else if (position) {
        actors.push({
          id: `zoom-ring-preview:${currentIndex}:${candidate.pairKey}:${side}`,
          imageId: side === 'A' ? current.image1Id : current.image2Id,
          categoryId: candidate.categoryId,
          x: Math.round(position.x),
          y: Math.round(position.y),
        } as AnnotationType);
      }
    }
    if (!actors.length) continue;
    const ids = new Set(actors.map((actor) => actor.id));
    const roots = new Set(
      actors.flatMap((actor) => (actor.objectId ? [actor.objectId] : []))
    );
    const chainOnly = [...preview.values()].filter(
      (annotation) =>
        !ids.has(annotation.id) &&
        (roots.has(annotation.id) ||
          (!!annotation.objectId && roots.has(annotation.objectId)))
    );
    const members = [...actors, ...chainOnly];
    // Same guard as linking: conflicting merges cannot be accepted.
    if (findSameImageAnnotationConflicts(members).length) continue;
    let oldest = members[0];
    for (const member of members.slice(1)) {
      if (
        isOlder(
          imagesById[member.imageId] ?? {},
          imagesById[oldest.imageId] ?? {}
        )
      )
        oldest = member;
    }
    for (const member of members) {
      const before = preview.get(member.id);
      if (
        !before ||
        before.objectId !== oldest.id ||
        before.x !== member.x ||
        before.y !== member.y
      ) {
        preview.set(member.id, { ...member, objectId: oldest.id });
        changedImages.add(member.imageId);
      }
    }
  }
  if (!changedImages.size) return views;
  const byImage: Record<string, AnnotationType[]> = {};
  for (const annotation of preview.values())
    (byImage[annotation.imageId] ??= []).push(annotation);
  return views.map((view, index) => {
    const pair = pairs[index];
    if (
      !pair ||
      (!changedImages.has(pair.image1Id) && !changedImages.has(pair.image2Id))
    )
      return view;
    const candidates = mergeCandidates(
      view.pairKeyStr,
      buildMatchCandidates({
        annotationsA: byImage[pair.image1Id] ?? [],
        annotationsB: byImage[pair.image2Id] ?? [],
        imageA: pair.imageA,
        imageB: pair.imageB,
        forward: pair.forward,
        backward: pair.backward,
        leniency,
        categoryFilter: categoryId,
      })
    );
    return {
      ...view,
      candidates,
      completion: evaluatePairCompletion(candidates),
    };
  });
}
