export function keepCurrent(
  ids: string[],
  previous: string[],
  currentId: string | null,
): string[] {
  if (!currentId || ids.includes(currentId)) return ids;
  const at = previous.indexOf(currentId);
  if (at < 0) return ids;
  return insertAfterPrevious(ids, previous, at - 1, currentId);
}

// Insert after the source image so Back returns to it.
export function insertVisit(
  ids: string[],
  previous: string[],
  visitId: string,
  fromId: string | null,
): string[] {
  if (ids.includes(visitId)) return ids;
  const at = fromId ? previous.indexOf(fromId) : -1;
  if (at < 0) return [visitId, ...ids];
  return insertAfterPrevious(ids, previous, at, visitId);
}

function insertAfterPrevious(
  ids: string[],
  previous: string[],
  from: number,
  id: string,
): string[] {
  const present = new Set(ids);
  let before = from;
  while (before >= 0 && !present.has(previous[before])) before--;
  const insertAt = before < 0 ? 0 : ids.indexOf(previous[before]) + 1;
  return [...ids.slice(0, insertAt), id, ...ids.slice(insertAt)];
}
