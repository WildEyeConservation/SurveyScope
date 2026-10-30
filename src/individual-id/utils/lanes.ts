import type { NeighbourPairWithMeta, PairCompletionState } from '../types';

// entries are flat pair indices — lanes are presentation-only; navigation uses the flat index.
export interface Lane {
  /** Stable React key for the row. */
  key: string;
  /**
   * 'camera'  — same-camera pairs for one camera.
   * 'overlap' — cross-camera pairs joining two cameras.
   */
  kind: 'camera' | 'overlap';
  label: string;
  entries: number[];
  /**
   * Per-entry timestamp from this lane's anchor camera, parallel to `entries`.
   * Used by simple-view to align lanes by time so dots in different cameras
   * that share a moment in time render at matching positions.
   */
  timestamps: number[];
}

/**
 * Group the flat `pairs` array into presentation rows. Same-camera pairs go in
 * their camera's row; cross-camera pairs get their own "overlap" row placed
 * directly after the earlier of the two cameras it joins. So cameras A and B
 * that overlap render as three rows: A, the A↔B overlap, then B. A cross-camera
 * pair lives in exactly one row (the overlap), never duplicated.
 */
export function buildLanes(
  pairs: NeighbourPairWithMeta[],
  cameraNamesById: Record<string, string>,
): Lane[] {
  // Camera order is first appearance in the flat pair list.
  const cameraOrder: string[] = [];
  const cameraIdx = (id: string): number => {
    let i = cameraOrder.indexOf(id);
    if (i === -1) {
      i = cameraOrder.length;
      cameraOrder.push(id);
    }
    return i;
  };

  const cameraEntries = new Map<string, number[]>();
  const overlapEntries = new Map<
    string,
    { lo: string; hi: string; entries: number[] }
  >();

  pairs.forEach((p, i) => {
    const camA = p.imageA.cameraId ?? '';
    const camB = p.imageB.cameraId ?? '';
    if (camA === camB) {
      cameraIdx(camA);
      let arr = cameraEntries.get(camA);
      if (!arr) {
        arr = [];
        cameraEntries.set(camA, arr);
      }
      arr.push(i);
    } else {
      // Order the two cameras so the overlap key/anchor is stable regardless
      // of which image happened to be imageA.
      const lo = cameraIdx(camA) <= cameraIdx(camB) ? camA : camB;
      const hi = lo === camA ? camB : camA;
      const key = `${lo}|${hi}`;
      let rec = overlapEntries.get(key);
      if (!rec) {
        rec = { lo, hi, entries: [] };
        overlapEntries.set(key, rec);
      }
      rec.entries.push(i);
    }
  });

  const cameraName = (id: string): string =>
    (id && cameraNamesById[id]) || `Camera ${cameraIdx(id) + 1}`;

  // Timestamp of the image taken by `cameraId`, used to order a row left→right.
  const tsForCamera = (p: NeighbourPairWithMeta, cameraId: string): number => {
    const img = (p.imageA.cameraId ?? '') === cameraId ? p.imageA : p.imageB;
    return img.timestamp ?? 0;
  };
  const sortByCamera = (
    entries: number[],
    cameraId: string,
  ): { entries: number[]; timestamps: number[] } => {
    const sorted = entries.slice().sort((a, b) => {
      const ta = tsForCamera(pairs[a], cameraId);
      const tb = tsForCamera(pairs[b], cameraId);
      if (ta !== tb) return ta - tb;
      return a - b;
    });
    return {
      entries: sorted,
      timestamps: sorted.map((i) => tsForCamera(pairs[i], cameraId)),
    };
  };

  const lanes: Lane[] = [];
  cameraOrder.forEach((cameraId) => {
    const sorted = sortByCamera(cameraEntries.get(cameraId) ?? [], cameraId);
    lanes.push({
      key: `cam:${cameraId}`,
      kind: 'camera',
      label: cameraName(cameraId),
      entries: sorted.entries,
      timestamps: sorted.timestamps,
    });
    // Overlap rows anchored to this camera (it is the earlier of the two),
    // nearest camera first.
    [...overlapEntries.values()]
      .filter((o) => o.lo === cameraId)
      .sort((a, b) => cameraIdx(a.hi) - cameraIdx(b.hi))
      .forEach((o) => {
        const sortedOverlap = sortByCamera(o.entries, o.lo);
        lanes.push({
          key: `ovl:${o.lo}|${o.hi}`,
          kind: 'overlap',
          label: `${cameraName(o.lo)} ↔ ${cameraName(o.hi)}`,
          entries: sortedOverlap.entries,
          timestamps: sortedOverlap.timestamps,
        });
      });
  });

  // A camera touched only by cross-camera pairs has an empty camera row —
  // drop it so no blank bar/label renders.
  return lanes.filter((l) => l.entries.length > 0);
}

/**
 * Simple-view filter with cross-lane time alignment:
 *
 *   1. Per-lane "attention" pass: keep every incomplete pair plus `radius`
 *      neighbours on either side, and always retain `keepIndex`.
 *   2. Compute the global timestamp window spanning every kept entry across
 *      every lane.
 *   3. Expand each lane to include every entry whose timestamp falls inside
 *      that window — so a lane with a narrow attention zone still renders
 *      dots at the same x-positions as a lane with a wider one, and 1-to-1
 *      cameras visually line up.
 */
export function filterLanesToAttention(
  lanes: Lane[],
  states: PairCompletionState[],
  keepIndex: number,
  radius: number,
): Lane[] {
  // Pass 1: per-lane attention mask.
  const masks: boolean[][] = lanes.map((lane) => {
    const { entries } = lane;
    const keep = new Array<boolean>(entries.length).fill(false);
    for (let i = 0; i < entries.length; i++) {
      if (entries[i] === keepIndex) keep[i] = true;
      if (states[entries[i]]?.status !== 'incomplete') continue;
      const lo = Math.max(0, i - radius);
      const hi = Math.min(entries.length - 1, i + radius);
      for (let j = lo; j <= hi; j++) keep[j] = true;
    }
    return keep;
  });

  // Pass 2: find the global timestamp window covering every kept entry.
  let globalMin = Infinity;
  let globalMax = -Infinity;
  lanes.forEach((lane, li) => {
    const keep = masks[li];
    for (let i = 0; i < keep.length; i++) {
      if (!keep[i]) continue;
      const t = lane.timestamps[i];
      if (t < globalMin) globalMin = t;
      if (t > globalMax) globalMax = t;
    }
  });

  // Pass 3: expand each mask to include entries inside the global window.
  // Skipped if no lane kept anything (nothing to align to).
  const hasWindow = globalMin !== Infinity;
  return lanes.map((lane, li) => {
    const keep = masks[li];
    if (hasWindow) {
      for (let i = 0; i < lane.timestamps.length; i++) {
        const t = lane.timestamps[i];
        if (t >= globalMin && t <= globalMax) keep[i] = true;
      }
    }
    return {
      ...lane,
      entries: lane.entries.filter((_, i) => keep[i]),
      timestamps: lane.timestamps.filter((_, i) => keep[i]),
    };
  });
}
