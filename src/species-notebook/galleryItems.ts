import type { GalleryItem } from './types';

const PERSON_SOURCES = ['manual', 'individual-id'];

export function isModelSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return !PERSON_SOURCES.some((prefix) => source.startsWith(prefix));
}

export function isPrimary(item: Pick<GalleryItem, 'id' | 'objectId'>) {
  return !item.objectId || item.objectId === item.id;
}

const time = (item: GalleryItem) =>
  item.createdAt ? Date.parse(item.createdAt) || 0 : 0;

// Prefer a mix of photos among equally ranked examples.
export function spreadByImage<T extends { imageId: string }>(
  items: readonly T[],
  rank: (item: T) => number,
): T[] {
  const out: T[] = [];
  let start = 0;
  while (start < items.length) {
    const r = rank(items[start]);
    let end = start;
    while (end < items.length && rank(items[end]) === r) end++;
    const queues = new Map<string, T[]>();
    for (const item of items.slice(start, end)) {
      const queue = queues.get(item.imageId);
      if (queue) queue.push(item);
      else queues.set(item.imageId, [item]);
    }
    let added = true;
    for (let round = 0; added; round++) {
      added = false;
      for (const queue of queues.values()) {
        if (round < queue.length) {
          out.push(queue[round]);
          added = true;
        }
      }
    }
    start = end;
  }
  return out;
}

export function arrangeItems(items: readonly GalleryItem[]): GalleryItem[] {
  const rank = (item: GalleryItem) =>
    (item.reviewed ? 0 : 2) + (isPrimary(item) ? 0 : 1);
  const sorted = [...items].sort(
    (a, b) => rank(a) - rank(b) || time(b) - time(a),
  );
  return spreadByImage(sorted, rank);
}
