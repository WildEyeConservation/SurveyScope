import type { ChainAnnotation } from '../types';

/**
 * One reviewer's net opinions on a share, keyed by snapshot annotation id
 * (`sharedAnnotationId` === `ChainAnnotation.id` === source annotation id).
 * Only divergent intents are stored; absence means "no opinion" (→ baseline).
 */
export interface Overlay {
  /** Proposed category id per annotation (relabel). */
  category: Map<string, string>;
  /** Proposed obscured flag per annotation. */
  obscured: Map<string, boolean>;
}

export function emptyOverlay(): Overlay {
  return { category: new Map(), obscured: new Map() };
}

/** Effective category for an annotation under an overlay (override ?? baseline). */
export function effectiveCategory(
  ann: ChainAnnotation,
  overlay: Overlay,
): string {
  return overlay.category.get(ann.id) ?? ann.categoryId;
}

/** Effective obscured flag for an annotation under an overlay (override ?? baseline). */
export function effectiveObscured(
  ann: ChainAnnotation,
  overlay: Overlay,
): boolean {
  const v = overlay.obscured.get(ann.id);
  return typeof v === 'boolean' ? v : ann.obscured;
}

export interface LabelDistribution {
  /** categoryId -> annotation count. */
  byCategory: Map<string, number>;
  total: number;
  oov: number;
  obscuredCount: number;
}

/** Distribution of annotations across categories under an overlay. */
export function computeDistribution(
  annotations: ChainAnnotation[],
  overlay: Overlay,
): LabelDistribution {
  const byCategory = new Map<string, number>();
  let oov = 0;
  let obscuredCount = 0;
  for (const ann of annotations) {
    const cat = effectiveCategory(ann, overlay);
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    if (ann.oov) oov += 1;
    else if (effectiveObscured(ann, overlay)) obscuredCount += 1;
  }
  return { byCategory, total: annotations.length, oov, obscuredCount };
}

/** Baseline distribution = distribution under an empty overlay. */
export function computeBaselineDistribution(
  annotations: ChainAnnotation[],
): LabelDistribution {
  return computeDistribution(annotations, emptyOverlay());
}

export interface ObscuredDiff {
  /** Baseline visible → reviewer obscured. */
  added: number;
  /** Baseline obscured → reviewer visible. */
  removed: number;
  /** added − removed (net change in obscured count). */
  net: number;
}

/**
 * How a reviewer's obscured opinions differ from baseline. OOV rows are skipped
 * (their obscured flag is meaningless and the tile UI never lets reviewers set
 * it).
 */
export function computeObscuredDiff(
  annotations: ChainAnnotation[],
  overlay: Overlay,
): ObscuredDiff {
  let added = 0;
  let removed = 0;
  for (const ann of annotations) {
    if (ann.oov) continue;
    const eff = effectiveObscured(ann, overlay);
    if (eff === ann.obscured) continue;
    if (eff) added += 1;
    else removed += 1;
  }
  return { added, removed, net: added - removed };
}

/** True when a reviewer's overlay diverges from baseline for this annotation. */
export function divergesCategory(
  ann: ChainAnnotation,
  overlay: Overlay,
): boolean {
  const proposed = overlay.category.get(ann.id);
  return proposed !== undefined && proposed !== ann.categoryId;
}

export function divergesObscured(
  ann: ChainAnnotation,
  overlay: Overlay,
): boolean {
  if (ann.oov) return false;
  const proposed = overlay.obscured.get(ann.id);
  return proposed !== undefined && proposed !== ann.obscured;
}

/** Pick the single value with the strictly-highest tally; ties return undefined. */
function pluralityWinner<T>(votes: T[]): T | undefined {
  if (votes.length === 0) return undefined;
  const tally = new Map<T, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  let tied = false;
  for (const [value, count] of tally) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

/**
 * Combined consensus overlay across reviewers: for each annotation, the
 * plurality opinion among reviewers who expressed one. Ties (and no opinion)
 * fall back to baseline by leaving the entry unset.
 */
export function computeCombinedOverlay(
  annotations: ChainAnnotation[],
  overlays: Overlay[],
): Overlay {
  const combined = emptyOverlay();
  for (const ann of annotations) {
    const catVotes: string[] = [];
    const obsVotes: boolean[] = [];
    for (const o of overlays) {
      const c = o.category.get(ann.id);
      if (c !== undefined) catVotes.push(c);
      const ob = o.obscured.get(ann.id);
      if (ob !== undefined) obsVotes.push(ob);
    }
    const catWinner = pluralityWinner(catVotes);
    if (catWinner !== undefined) combined.category.set(ann.id, catWinner);
    const obsWinner = pluralityWinner(obsVotes);
    if (obsWinner !== undefined) combined.obscured.set(ann.id, obsWinner);
  }
  return combined;
}
