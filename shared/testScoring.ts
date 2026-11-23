import { isWithinLocationBounds } from './locationGeometry';

export type TestAnnotation = {
  id: string;
  x: number;
  y: number;
  categoryId: string;
};

type Bounds = {
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
};

export type TestKeyCount = {
  categoryId: string;
  category: { name: string };
  count: number;
};

export type KeyAnnotation = {
  x: number;
  y: number;
  categoryId: string;
  category?: { name: string } | null;
};

export function countTestKey(
  annotations: KeyAnnotation[],
  location: Bounds,
): TestKeyCount[] {
  const counts = new Map<string, TestKeyCount>();
  for (const annotation of annotations) {
    if (!isWithinLocationBounds(annotation, location)) continue;
    const entry = counts.get(annotation.categoryId);
    if (entry) entry.count += 1;
    else
      counts.set(annotation.categoryId, {
        categoryId: annotation.categoryId,
        category: { name: annotation.category?.name ?? '' },
        count: 1,
      });
  }
  return [...counts.values()];
}

export function countTestAnnotations(
  {
    local,
    stored,
    deletedIds,
  }: {
    local: TestAnnotation[];
    stored: TestAnnotation[];
    deletedIds: ReadonlySet<string>;
  },
  location: Bounds,
  categoryNames: Record<string, string>,
): Record<string, number> {
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  const live = stored.filter((annotation) => !deletedIds.has(annotation.id));
  for (const annotation of [...local, ...live]) {
    if (seen.has(annotation.id)) continue;
    seen.add(annotation.id);
    if (!isWithinLocationBounds(annotation, location)) continue;
    const name = categoryNames[annotation.categoryId];
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

// Older rows stored overcounts as negative misses, or split them by label.
export function tallyTestResult(result: {
  testAnimals: number;
  totalMissedAnimals: number;
  falsePositives?: number | null;
}) {
  const marked =
    result.testAnimals -
    result.totalMissedAnimals +
    (result.falsePositives ?? 0);
  return {
    found: Math.min(marked, result.testAnimals),
    over: Math.max(0, marked - result.testAnimals),
  };
}
