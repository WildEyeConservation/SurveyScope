import type {
  AnnotationType,
  ImageNeighbourType,
  ImageType,
} from '../../schemaTypes';
import { evaluatePairCompletion } from './completion';
import { buildMatchCandidates } from './munkres';
import { findReunions } from './reunionSearch';
import { buildNeighbourTransforms } from './transforms';

// Must match IndividualIdHarness DEFAULT_LENIENCY so launch-time completeness agrees with runtime.
export const DEFAULT_INDIVIDUAL_ID_LENIENCY = 40;

// Must match IndividualIdHarness REUNION_MAX_HOPS so launch-time reunion search agrees with runtime.
export const DEFAULT_REUNION_MAX_HOPS = 20;

export interface TransectCompletenessInput {
  imagesById: Record<string, ImageType>;
  imageIdsByTransect: Map<string, Set<string>>;
  rawNeighbours: ImageNeighbourType[];
  /**
   * Annotations for ALL categories, not just the launch category. Direct-pair
   * evaluation filters via `categoryFilter` internally; reunion search needs
   * the full set so chain membership (via shared objectIds) matches what the
   * harness sees at runtime.
   */
  annotationsByImage: Record<string, AnnotationType[]>;
  categoryId: string;
  leniency?: number;
  maxHops?: number;
}

// Pair orientation is irrelevant — swapping A/B also swaps forward/backward, so candidate sets are invariant.
export function findIncompleteTransectIds(
  input: TransectCompletenessInput,
): string[] {
  const {
    imagesById,
    imageIdsByTransect,
    rawNeighbours,
    annotationsByImage,
    categoryId,
  } = input;
  const leniency = input.leniency ?? DEFAULT_INDIVIDUAL_ID_LENIENCY;
  const maxHops = input.maxHops ?? DEFAULT_REUNION_MAX_HOPS;

  const transectOf = new Map<string, string>();
  for (const [tId, ids] of imageIdsByTransect) {
    for (const id of ids) transectOf.set(id, tId);
  }

  const neighboursByTransect = new Map<string, ImageNeighbourType[]>();
  for (const n of rawNeighbours) {
    const t1 = transectOf.get(n.image1Id);
    const t2 = transectOf.get(n.image2Id);
    if (!t1 || t1 !== t2) continue;
    let arr = neighboursByTransect.get(t1);
    if (!arr) {
      arr = [];
      neighboursByTransect.set(t1, arr);
    }
    arr.push(n);
  }

  const incomplete: string[] = [];
  for (const [tId, neighbours] of neighboursByTransect) {
    let hasPair = false;
    let anyIncomplete = false;
    for (const n of neighbours) {
      const tfs = buildNeighbourTransforms(n);
      if (tfs.noHomography) continue;
      const imageA = imagesById[n.image1Id];
      const imageB = imagesById[n.image2Id];
      if (!imageA || !imageB) continue;
      hasPair = true;
      const candidates = buildMatchCandidates({
        annotationsA: annotationsByImage[n.image1Id] ?? [],
        annotationsB: annotationsByImage[n.image2Id] ?? [],
        imageA,
        imageB,
        forward: tfs.forward,
        backward: tfs.backward,
        leniency,
        categoryFilter: categoryId,
      });
      if (evaluatePairCompletion(candidates).status === 'incomplete') {
        anyIncomplete = true;
        break;
      }
    }
    if (!hasPair) continue;
    if (anyIncomplete) {
      incomplete.push(tId);
      continue;
    }
    // Every direct pair is complete — mirror the harness's completion
    // detector: the transect only counts as done if reunion search surfaces
    // no actionable synthetic pairs. Otherwise a transect whose annotations
    // are all linked but whose chains still need merging would block launch.
    if (
      hasIncompleteReunion({
        transectImageIds: imageIdsByTransect.get(tId),
        neighbours,
        imagesById,
        annotationsByImage,
        categoryId,
        leniency,
        maxHops,
      })
    ) {
      incomplete.push(tId);
    }
  }
  return incomplete;
}

// Mirrors the actionability filter in IndividualIdHarness's completion
// detector: a reunion candidate only counts when the Munkres pass over the
// synthetic pair actually leaves work to do (it can come out all-accepted or
// all-informational, in which case the harness silently drops it too).
function hasIncompleteReunion({
  transectImageIds,
  neighbours,
  imagesById,
  annotationsByImage,
  categoryId,
  leniency,
  maxHops,
}: {
  transectImageIds: Set<string> | undefined;
  neighbours: ImageNeighbourType[];
  imagesById: Record<string, ImageType>;
  annotationsByImage: Record<string, AnnotationType[]>;
  categoryId: string;
  leniency: number;
  maxHops: number;
}): boolean {
  if (!transectImageIds) return false;
  const annotations: AnnotationType[] = [];
  for (const imageId of transectImageIds) {
    const anns = annotationsByImage[imageId];
    if (anns) annotations.push(...anns);
  }
  if (annotations.length === 0) return false;

  const candidates = findReunions({
    annotations,
    rawNeighbours: neighbours,
    imagesById,
    categoryId,
    leniency,
    maxHops,
  });

  for (const c of candidates) {
    const imageA = imagesById[c.imageAId];
    const imageB = imagesById[c.imageBId];
    if (!imageA || !imageB) continue;
    const built = buildMatchCandidates({
      annotationsA: annotationsByImage[c.imageAId] ?? [],
      annotationsB: annotationsByImage[c.imageBId] ?? [],
      imageA,
      imageB,
      forward: c.forward,
      backward: c.backward,
      leniency,
      categoryFilter: categoryId,
    });
    if (evaluatePairCompletion(built).status === 'incomplete') return true;
  }
  return false;
}
