export type LocationBox = {
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CandidateRef = { annotationSetId: string; locationId: string };

export type PoolEntry = CandidateRef & {
  location: LocationBox;
  categoryIds: string[];
};

export type PresetLocation = CandidateRef & {
  sourceLocationId?: string | null;
  location?: Partial<LocationBox> | null;
};

export const candidateKey = (c: CandidateRef) =>
  `${c.annotationSetId}_${c.locationId}`;

// Preset locations are copies with new IDs; older ones lack sourceLocationId.
export function findAddedKeys(
  pool: PoolEntry[],
  presetLocations: PresetLocation[]
): Set<string> {
  const added = new Set<string>();
  const byImage = new Map<string, PoolEntry[]>();
  for (const entry of pool) {
    const key = `${entry.annotationSetId}_${entry.location.imageId}`;
    if (!byImage.has(key)) byImage.set(key, []);
    byImage.get(key)!.push(entry);
  }

  for (const preset of presetLocations) {
    added.add(candidateKey(preset));
    if (preset.sourceLocationId) {
      added.add(`${preset.annotationSetId}_${preset.sourceLocationId}`);
      continue;
    }
    const copy = preset.location;
    if (!copy || copy.imageId == null || copy.x == null || copy.y == null) {
      continue;
    }
    let nearest: PoolEntry | null = null;
    let nearestDistance = Infinity;
    for (const entry of byImage.get(
      `${preset.annotationSetId}_${copy.imageId}`
    ) ?? []) {
      const dx = Math.abs(copy.x - entry.location.x);
      const dy = Math.abs(copy.y - entry.location.y);
      if (dx > entry.location.width / 2 || dy > entry.location.height / 2) {
        continue;
      }
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    if (nearest) added.add(candidateKey(nearest));
  }
  return added;
}

export function filterCandidates(
  pool: PoolEntry[],
  categoryId: string,
  maxAnnotations: number | '',
  excludedKeys: Set<string>
): CandidateRef[] {
  const limit = maxAnnotations === '' ? null : Number(maxAnnotations);
  const seenLocationIds = new Set<string>();
  const candidates: CandidateRef[] = [];
  for (const entry of pool) {
    if (excludedKeys.has(candidateKey(entry))) continue;
    if (categoryId && !entry.categoryIds.includes(categoryId)) continue;
    if (limit != null && entry.categoryIds.length > limit) continue;
    if (seenLocationIds.has(entry.locationId)) continue;
    seenLocationIds.add(entry.locationId);
    candidates.push({
      annotationSetId: entry.annotationSetId,
      locationId: entry.locationId,
    });
  }
  return candidates;
}
