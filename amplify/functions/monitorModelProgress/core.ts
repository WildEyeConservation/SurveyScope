export class OutOfTimeError extends Error {}

export function timeBudget(deadlineMs: number, now: () => number = Date.now) {
  return () => {
    if (now() > deadlineMs) {
      throw new OutOfTimeError('Run time budget exhausted');
    }
  };
}

export type ImageIdPage = (
  nextToken?: string,
) => Promise<{ imageIds: string[]; nextToken?: string | null }>;

// Streams page by page; a large survey can have millions of locations.
// onFound runs per page so progress survives running out of time.
export async function findImageIdsInPages(
  wantedIds: Iterable<string>,
  fetchPage: ImageIdPage,
  onFound: (imageIds: string[]) => Promise<void>,
  ensureTime: () => void,
): Promise<{ found: Set<string>; scanned: number }> {
  const wanted = new Set(wantedIds);
  const found = new Set<string>();
  let nextToken: string | undefined;
  let scanned = 0;
  do {
    ensureTime();
    const page = await fetchPage(nextToken);
    const newlyFound: string[] = [];
    for (const imageId of page.imageIds) {
      if (wanted.has(imageId) && !found.has(imageId)) {
        found.add(imageId);
        newlyFound.push(imageId);
      }
    }
    if (newlyFound.length > 0) await onFound(newlyFound);
    scanned += page.imageIds.length;
    nextToken = page.nextToken ?? undefined;
  } while (nextToken && found.size < wanted.size);
  return { found, scanned };
}

export function shuffle<T>(items: T[], random: () => number = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
