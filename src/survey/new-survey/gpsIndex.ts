// Indexed lookups over the GPS rows that drive survey-upload georeferencing.
// The upload UI repeatedly answers "which GPS row matches this image?" for up
// to ~100k images; a linear scan per image is O(n^2) and locks the tab, so
// every matcher here is backed by a Map or a binary search over one shared
// sorted array built once per row set.

export type GpsRow = {
  timestamp?: number;
  filepath?: string;
  lat: number;
  lng: number;
  alt: number;
};

export interface GpsIndex {
  /** Rows keyed by exact timestamp (first row wins on duplicates). */
  byTimestamp: Map<number, GpsRow>;
  /** Rows keyed by lower-cased filepath (first row wins on duplicates). */
  byFilepath: Map<string, GpsRow>;
  /** Rows with a finite timestamp, sorted ascending. */
  sorted: GpsRow[];
  /** NaN when there are no timestamped rows. */
  minTimestamp: number;
  /** NaN when there are no timestamped rows. */
  maxTimestamp: number;
  /** Mean gap between consecutive timestamps; NaN with fewer than 2 rows. */
  avgInterval: number;
}

export function buildGpsIndex(rows: GpsRow[]): GpsIndex {
  const byTimestamp = new Map<number, GpsRow>();
  const byFilepath = new Map<string, GpsRow>();
  const sorted: GpsRow[] = [];
  for (const row of rows) {
    if (typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)) {
      if (!byTimestamp.has(row.timestamp)) byTimestamp.set(row.timestamp, row);
      sorted.push(row);
    }
    if (row.filepath) {
      const key = row.filepath.toLowerCase();
      if (!byFilepath.has(key)) byFilepath.set(key, row);
    }
  }
  sorted.sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
  const n = sorted.length;
  const minTimestamp = n > 0 ? (sorted[0].timestamp as number) : NaN;
  const maxTimestamp = n > 0 ? (sorted[n - 1].timestamp as number) : NaN;
  const avgInterval = n >= 2 ? (maxTimestamp - minTimestamp) / (n - 1) : NaN;
  return {
    byTimestamp,
    byFilepath,
    sorted,
    minTimestamp,
    maxTimestamp,
    avgInterval,
  };
}

/**
 * The pair of timestamped rows bracketing ts, or null when ts falls outside
 * the timestamped range (or there are fewer than 2 rows). An exact hit
 * brackets itself (prev === next).
 */
export function bracketTimestamp(
  index: GpsIndex,
  ts: number
): { prev: GpsRow; next: GpsRow } | null {
  const { sorted } = index;
  if (sorted.length < 2) return null;
  if (ts < index.minTimestamp || ts > index.maxTimestamp) return null;
  // Binary search for the first row with timestamp >= ts.
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid].timestamp as number) < ts) lo = mid + 1;
    else hi = mid;
  }
  if ((sorted[lo].timestamp as number) === ts) {
    return { prev: sorted[lo], next: sorted[lo] };
  }
  if (lo === 0) return null;
  return { prev: sorted[lo - 1], next: sorted[lo] };
}

/**
 * Exact-or-interpolated GPS fix at ts. Returns null outside the timestamped
 * range instead of extrapolating.
 */
export function interpolateAt(
  index: GpsIndex,
  ts: number
): { timestamp: number; lat: number; lng: number; alt: number } | null {
  const exact = index.byTimestamp.get(ts);
  if (exact) {
    return { timestamp: ts, lat: exact.lat, lng: exact.lng, alt: exact.alt };
  }
  const bracket = bracketTimestamp(index, ts);
  if (!bracket) return null;
  const { prev, next } = bracket;
  if (prev === next) {
    return { timestamp: ts, lat: prev.lat, lng: prev.lng, alt: prev.alt };
  }
  const prevTs = prev.timestamp as number;
  const nextTs = next.timestamp as number;
  const pos = (ts - prevTs) / (nextTs - prevTs);
  return {
    timestamp: ts,
    lat: prev.lat * (1 - pos) + next.lat * pos,
    lng: prev.lng * (1 - pos) + next.lng * pos,
    alt: prev.alt * (1 - pos) + next.alt * pos,
  };
}

/**
 * Loop-based min/max. `Math.min(...arr)` throws a RangeError (call stack
 * overflow) somewhere above ~100k elements, which large surveys exceed.
 * Non-finite values are skipped; returns null when nothing finite remains.
 */
export function minMaxOf(
  values: Iterable<number>
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let seen = false;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    seen = true;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return seen ? { min, max } : null;
}

// Value-based identity: row objects are rebuilt when the data is re-read.
export function gpsRowKey(row: GpsRow): string {
  return `${row.filepath ?? ''}|${row.timestamp ?? ''}|${row.lat}|${row.lng}|${
    row.alt
  }`;
}

// Rows the map was never offered cannot be restored through it.
export function nextMapRemovedKeys(
  prev: Set<string>,
  offered: GpsRow[],
  visible: GpsRow[]
): Set<string> {
  const visibleKeys = new Set(visible.map(gpsRowKey));
  const next = new Set<string>();
  for (const key of prev) if (!visibleKeys.has(key)) next.add(key);
  for (const row of offered) {
    const key = gpsRowKey(row);
    if (!visibleKeys.has(key)) next.add(key);
  }
  return next;
}
