import { isWithinLocationBounds } from './utils';

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
