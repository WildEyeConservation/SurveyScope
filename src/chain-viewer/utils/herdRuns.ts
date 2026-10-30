/**
 * "Herd run" grouping for the herd viewer's single timestamp-ordered lane.
 *
 * A herd run is a maximal contiguous run of (time-ordered) animal-pairs that
 * are transitively chain-linked: walking the sequence, a new run starts the
 * moment a pair shares no chain with the previous one. Each run is therefore
 * one herd sighting — the same individual(s) followed across consecutive
 * frames (and across cameras, since the single lane interleaves them by time).
 */

/** True when two chain-id sets have no member in common. */
export function disjoint(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) return false;
  return true;
}

export interface HerdRuns {
  /** Run id for each pair index (parallel to the input array). */
  runIdByIndex: number[];
  /** Pair index where each run begins, in order. `runStarts.length` = run count. */
  runStarts: number[];
}

/**
 * Assign herd-run ids to a timestamp-ordered list of chain sets (one per pair).
 * A new run starts whenever a pair shares no chain with the previous one. An
 * empty set (a pair with no animals — not expected in the herd viewer) breaks
 * the run and stands alone.
 */
export function buildHerdRuns(
  chainSets: Set<string>[],
  herdIds?: string[],
): HerdRuns {
  const runIdByIndex: number[] = [];
  const runStarts: number[] = [];
  let prev: Set<string> | null = null;
  let prevHerdId: string | null = null;
  let runIdx = -1;
  chainSets.forEach((cur, i) => {
    const set = cur ?? new Set<string>();
    const changedHerd = herdIds !== undefined && herdIds[i] !== prevHerdId;
    if (
      prev === null ||
      set.size === 0 ||
      changedHerd ||
      (herdIds === undefined && disjoint(prev, set))
    ) {
      runIdx++;
      runStarts.push(i);
    }
    runIdByIndex.push(runIdx);
    prev = set.size === 0 ? null : set;
    prevHerdId = herdIds?.[i] ?? null;
  });
  return { runIdByIndex, runStarts };
}
