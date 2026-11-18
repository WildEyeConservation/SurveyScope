import type { TestContextAnnotation } from '../api/tasks';
import type { ExtendedAnnotationType } from '../schemaTypes';
import { isFalseNegative } from './annotationFeatures';

interface NamedCategory {
  id: string;
  name: string;
}

interface TestContextOptions {
  // The server has already left out every test's answer box.
  annotations: TestContextAnnotation[];
  jobCategories: NamedCategory[];
  hideFnAnnotations?: boolean;
}

export function selectTestContextAnnotations({
  annotations,
  jobCategories,
  hideFnAnnotations,
}: TestContextOptions): ExtendedAnnotationType[] {
  const jobIdByName = new Map<string, string>();
  for (const category of jobCategories) {
    const name = category.name.toLowerCase();
    if (!jobIdByName.has(name)) jobIdByName.set(name, category.id);
  }
  return annotations.flatMap((annotation) => {
    if (hideFnAnnotations && isFalseNegative(annotation)) return [];
    const categoryId = jobIdByName.get(annotation.categoryName.toLowerCase());
    return categoryId
      ? [{ ...annotation, categoryId } as unknown as ExtendedAnnotationType]
      : [];
  });
}
