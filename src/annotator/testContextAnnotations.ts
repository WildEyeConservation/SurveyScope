import type { ExtendedAnnotationType } from '../schemaTypes';
import { isWithinLocationBounds } from '../utils';
import { isFalseNegative } from './annotationFeatures';

interface NamedCategory {
  id: string;
  name: string;
}

interface TestContextOptions {
  annotations: ExtendedAnnotationType[];
  sourceCategories: NamedCategory[];
  jobCategories: NamedCategory[];
  location: {
    x: number;
    y: number;
    width?: number | null;
    height?: number | null;
  };
  hideFnAnnotations?: boolean;
}

export function selectTestContextAnnotations({
  annotations,
  sourceCategories,
  jobCategories,
  location,
  hideFnAnnotations,
}: TestContextOptions): ExtendedAnnotationType[] {
  if (!location.width || !location.height) return [];
  const sourceNames = new Map(
    sourceCategories.map((c) => [c.id, c.name.toLowerCase()]),
  );
  const jobIdByName = new Map<string, string>();
  for (const category of jobCategories) {
    const name = category.name.toLowerCase();
    if (!jobIdByName.has(name)) jobIdByName.set(name, category.id);
  }
  return annotations.flatMap((annotation) => {
    if (isWithinLocationBounds(annotation, location)) return [];
    if (hideFnAnnotations && isFalseNegative(annotation)) return [];
    const name = sourceNames.get(annotation.categoryId);
    const categoryId = name === undefined ? undefined : jobIdByName.get(name);
    return categoryId ? [{ ...annotation, categoryId }] : [];
  });
}
