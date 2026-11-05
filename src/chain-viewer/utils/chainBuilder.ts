import type { Chain, ChainAnnotation } from '../types';

/**
 * Group annotations into chains keyed by their primary objectId. The primary
 * annotation has `objectId === id`; other annotations share that objectId.
 * Annotations with no objectId at all are treated as their own singleton
 * chains keyed by the annotation id — they have no linked sightings yet but
 * are still primaries worth surfacing for review.
 *
 * Returns chains sorted by size (desc), with `primaryId` as a stable
 * secondary sort so navigation order is deterministic across reloads.
 */
export function buildChains(annotations: ChainAnnotation[]): Chain[] {
  const byPrimary = new Map<string, ChainAnnotation[]>();
  for (const a of annotations) {
    const key = a.objectId ?? a.id;
    let bucket = byPrimary.get(key);
    if (!bucket) {
      bucket = [];
      byPrimary.set(key, bucket);
    }
    bucket.push(a);
  }

  const chains: Chain[] = [];
  for (const [primaryId, group] of byPrimary) {
    const primary = group.find((g) => g.id === primaryId) ?? group[0];
    // Within-chain order: image timestamp ascending; nulls sort last; tie
    // break on annotation id for determinism.
    const ordered = [...group].sort((a, b) => {
      const ta = a.imageTimestamp;
      const tb = b.imageTimestamp;
      if (ta === null && tb === null) return a.id.localeCompare(b.id);
      if (ta === null) return 1;
      if (tb === null) return -1;
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });
    chains.push({
      primaryId,
      categoryId: primary.categoryId,
      annotations: ordered,
    });
  }

  chains.sort((a, b) => {
    if (b.annotations.length !== a.annotations.length) {
      return b.annotations.length - a.annotations.length;
    }
    return a.primaryId.localeCompare(b.primaryId);
  });

  return chains;
}
