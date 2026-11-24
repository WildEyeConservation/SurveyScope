import type { TileCoordinate } from './imageTiles';

export const NOTEBOOK_LIMIT = 20;
export const CROP_SIZE = 512;

export type NotebookCandidate = {
  id: string;
  imageId: string;
  projectId: string;
  objectId?: string | null;
  source?: string | null;
  reviewed: boolean;
  createdAt?: string | null;
};

export type NotebookExample = {
  token: string;
  reviewed: boolean;
  model: boolean;
  borrowed: boolean;
  // Only for admins of the example's survey, who can read its annotations anyway.
  explore?: {
    projectId: string;
    imageId: string;
    annotationSetId: string;
    categoryId: string;
  };
};

export type NotebookExamples = {
  examples: NotebookExample[];
  borrowedSurveys: number;
};

// A square image with the example at its centre.
export type NotebookCrop = { size: number; type: string; data: string };

const PERSON_SOURCES = ['manual', 'individual-id'];

export function isModelSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return !PERSON_SOURCES.some((prefix) => source.startsWith(prefix));
}

export function isPrimary(item: { id: string; objectId?: string | null }) {
  return !item.objectId || item.objectId === item.id;
}

const time = (item: NotebookCandidate) =>
  item.createdAt ? Date.parse(item.createdAt) || 0 : 0;

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

export function arrangeItems<T extends NotebookCandidate>(
  items: readonly T[],
): T[] {
  const rank = (item: T) => (item.reviewed ? 0 : 2) + (isPrimary(item) ? 0 : 1);
  const sorted = [...items].sort(
    (a, b) => rank(a) - rank(b) || time(b) - time(a),
  );
  return spreadByImage(sorted, rank);
}

// Takes turns across surveys so one large survey can't crowd out the rest.
export function sampleAcrossSurveys<T extends NotebookCandidate>(
  items: readonly T[],
  limit: number,
): T[] {
  const bySurvey = new Map<string, T[]>();
  for (const item of items) {
    const list = bySurvey.get(item.projectId);
    if (list) list.push(item);
    else bySurvey.set(item.projectId, [item]);
  }
  const queues = [...bySurvey.values()].map((list) => arrangeItems(list));
  const out: T[] = [];
  for (let round = 0; out.length < limit; round++) {
    let added = false;
    for (const queue of queues) {
      if (round >= queue.length || out.length >= limit) continue;
      out.push(queue[round]);
      added = true;
    }
    if (!added) break;
  }
  return out;
}

// Exact string equality on purpose: near-miss names may be different species.
export function matchingCategories<
  T extends { name: string; projectId: string },
>(name: string, categories: readonly T[], excludeProjectId: string): T[] {
  return categories.filter(
    (category) =>
      category.name === name && category.projectId !== excludeProjectId,
  );
}

export type CropWindow = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function cropWindow(
  point: { x: number; y: number },
  size = CROP_SIZE,
): CropWindow {
  return {
    left: Math.round(point.x) - size / 2,
    top: Math.round(point.y) - size / 2,
    width: size,
    height: size,
  };
}

export function insideImage(
  crop: CropWindow,
  image: { width: number; height: number },
): CropWindow | null {
  const left = Math.max(0, crop.left);
  const top = Math.max(0, crop.top);
  const right = Math.min(image.width, crop.left + crop.width);
  const bottom = Math.min(image.height, crop.top + crop.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

// Padding would show how far the example is from the image edge.
export function cropFits(
  point: { x: number; y: number },
  image: { width: number; height: number },
): boolean {
  const crop = cropWindow(point);
  const area = insideImage(crop, image);
  return area?.width === crop.width && area.height === crop.height;
}

export function cropTiles(
  area: CropWindow,
  pyramid: { tileSize: number; maxZoom: number },
): TileCoordinate[] {
  const { tileSize, maxZoom } = pyramid;
  const tiles: TileCoordinate[] = [];
  const lastRow = Math.floor((area.top + area.height - 1) / tileSize);
  const lastCol = Math.floor((area.left + area.width - 1) / tileSize);
  for (let row = Math.floor(area.top / tileSize); row <= lastRow; row++)
    for (let col = Math.floor(area.left / tileSize); col <= lastCol; col++)
      tiles.push({ z: maxZoom, row, col });
  return tiles;
}
