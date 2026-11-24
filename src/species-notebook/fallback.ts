import { arrangeItems } from './galleryItems';
import type { GalleryItem, SurveyCategory } from './types';

// Exact string equality on purpose: near-miss names may be different species.
export function matchingCategories(
  name: string,
  categories: readonly SurveyCategory[],
  excludeProjectId: string,
): SurveyCategory[] {
  return categories.filter(
    (category) =>
      category.name === name && category.projectId !== excludeProjectId,
  );
}

// Takes turns across surveys so one large survey can't crowd out the rest.
export function sampleAcrossSurveys(
  items: readonly GalleryItem[],
  limit: number,
): GalleryItem[] {
  const bySurvey = new Map<string, GalleryItem[]>();
  for (const item of items) {
    const list = bySurvey.get(item.projectId);
    if (list) list.push(item);
    else bySurvey.set(item.projectId, [item]);
  }
  const queues = [...bySurvey.values()].map((list) => arrangeItems(list));
  const out: GalleryItem[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const queue of queues) {
      if (round >= queue.length || out.length >= limit) continue;
      out.push({ ...queue[round], borrowed: true });
      added = true;
    }
    if (!added) break;
  }
  return out;
}
