import type { DataClient } from '../amplify/shared/data-schema.generated';
import { fetchAllPaginatedResults } from './utils';

export const isFalsePositiveName = (name: string) =>
  name.trim().toLowerCase() === 'false positive';

export async function ensureFalsePositiveCategory(
  client: DataClient,
  set: { projectId: string; annotationSetId: string; group?: string | null },
) {
  const categories = await fetchAllPaginatedResults(
    client.models.Category.categoriesByAnnotationSetId,
    {
      annotationSetId: set.annotationSetId,
      selectionSet: ['id', 'name', 'shortcutKey'] as const,
    },
  );
  const existing = categories.find((c) => isFalsePositiveName(c.name));
  if (existing)
    return { ...existing, shortcutKey: existing.shortcutKey ?? null };
  const { data } = await client.models.Category.create({
    projectId: set.projectId,
    annotationSetId: set.annotationSetId,
    name: 'False Positive',
    shortcutKey: '+',
    color: '#888888',
    group: set.group ?? undefined,
  });
  if (!data) throw new Error('Failed to create the False Positive category');
  return {
    id: data.id,
    name: data.name,
    shortcutKey: data.shortcutKey ?? null,
  };
}
