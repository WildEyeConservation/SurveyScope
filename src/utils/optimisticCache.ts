/*
Pure cache transforms behind the rollbacks in useOptimisticUpdates.

Two rules drive all of them:

1. A write that AppSync rejects — most often an authorization failure — comes
   back as a null row with *no* `errors` array. limitedClient only throws on
   `errors`, so react-query counts that as a success. Anything relying on
   onError alone will leave an optimistic row on screen that was never written.

2. Rollbacks touch only the affected row, never a whole-list snapshot. Rows are
   created in rapid succession, so the snapshot taken before mutation A does not
   contain rows B and C that landed while A was in flight; restoring it would
   drop persisted rows from the display and invite the user to re-create them.
*/

type KeyFn<T> = (item: T) => unknown;

/** Whether a mutation answered without a row, meaning the write did not land. */
export function isMissingRow(result: unknown): boolean {
  return (result as { data?: unknown } | null | undefined)?.data == null;
}

/** Drops the optimistic row for a create that turned out to have failed. */
export function withoutRow<T>(
  rows: readonly T[],
  item: T,
  getKey: KeyFn<T>
): T[] {
  const key = getKey(item);
  return rows.filter((existing) => getKey(existing) !== key);
}

/** Puts back the pre-update version of a row whose update failed. */
export function withRowRestored<T>(
  rows: readonly T[],
  item: T,
  previousItems: readonly T[] | undefined,
  getKey: KeyFn<T>
): T[] {
  const key = getKey(item);
  const previous = previousItems?.find(
    (candidate) => getKey(candidate) === key
  );
  if (!previous) return [...rows];
  return rows.map((existing) =>
    getKey(existing) === key ? previous : existing
  );
}

/** Puts back a row whose delete failed, without duplicating it. */
export function withRowReinstated<T>(
  rows: readonly T[],
  item: T,
  previousItems: readonly T[] | undefined,
  getKey: KeyFn<T>
): T[] {
  const key = getKey(item);
  const previous = previousItems?.find(
    (candidate) => getKey(candidate) === key
  );
  if (!previous) return [...rows];
  if (rows.some((existing) => getKey(existing) === key)) return [...rows];
  return [...rows, previous];
}
