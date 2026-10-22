import type {
  BoundaryStatus,
  LatLngRing,
} from '../../../shared/boundaryStatus';
import {
  detectTransects,
  TRACK_POSITION_TOLERANCE_METERS,
} from '../shared/detectTransects';
import {
  createStratumLocator,
  hasStratumShape,
  stratumMetrics,
  type TrackPoint,
} from '../../../shared/strataMetrics';

export function boundaryStatusChange(
  current: BoundaryStatus | null | undefined,
  next: BoundaryStatus | null
): 'skip' | 'set' | 'remove' {
  if ((current ?? 'inside') === (next ?? 'inside')) return 'skip';
  return next ? 'set' : 'remove';
}

export interface RecomputeLease {
  // False when another run holds the lease.
  acquire(): Promise<boolean>;
  // Expiry of the current lease, which its holder keeps extending.
  current(): Promise<string | null>;
  // False when a new request arrived during the pass.
  release(): Promise<boolean>;
  // Clears the request and extends the lease before another pass.
  renew(): Promise<void>;
}

export async function runSerialized(
  lease: RecomputeLease,
  pass: () => Promise<void>,
  options: { sleep: (ms: number) => Promise<void>; holderCheckMs: number }
): Promise<number> {
  for (;;) {
    if (await lease.acquire()) break;
    const seen = await lease.current();
    await options.sleep(options.holderCheckMs);
    const now = await lease.current();
    if (now && now !== seen) return 0;
  }
  let passes = 0;
  for (;;) {
    passes += 1;
    await pass();
    if (await lease.release()) return passes;
    await lease.renew();
  }
}

export type DesignImage = {
  id: string;
  timestamp: number;
  cameraId: string | null;
  latitude: number | null;
  longitude: number | null;
  onEffort: boolean;
  wasOnEffort: boolean;
  transectId: string | null;
};

export type DesignStratum = {
  id: string;
  coords: LatLngRing;
  offEffort: boolean;
};

export type StratumStats = {
  id: string;
  area: number;
  baselineLength: number;
};

export type ImageMove = { id: string; from: string | null; to: string | null };

export type StrataPlan = {
  imageMoves: ImageMove[];
  transectStrata: { id: string; stratumId: string }[];
  strata: StratumStats[];
  // Strata without a shape, such as one made for chain linking.
  deleteStrata: string[];
};

const hasPosition = (img: DesignImage) =>
  Number.isFinite(img.latitude) && Number.isFinite(img.longitude);

export function planStrata(input: {
  images: DesignImage[];
  transects: { id: string; stratumId: string | null }[];
  strata: DesignStratum[];
  exclusions: LatLngRing[];
}): StrataPlan {
  const outsideStrata = new Set(
    input.strata.filter((st) => st.offEffort).map((st) => st.id)
  );
  const shaped = input.strata.filter(
    (st) => !st.offEffort && hasStratumShape(st.coords)
  );
  const shapeless = input.strata.filter(
    (st) => !st.offEffort && !hasStratumShape(st.coords)
  );
  const current = shaped.length ? shaped : shapeless;
  const outsideTransects = new Set(
    input.transects
      .filter((t) => t.stratumId && outsideStrata.has(t.stratumId))
      .map((t) => t.id)
  );
  const moves = new Map<string, ImageMove>();
  const members = new Map<string, DesignImage[]>();
  const join = (img: DesignImage, transectId: string) => {
    let list = members.get(transectId);
    if (!list) members.set(transectId, (list = []));
    list.push(img);
  };
  for (const img of input.images) {
    if (!img.transectId) continue;
    if (outsideTransects.has(img.transectId) === img.onEffort) {
      moves.set(img.id, { id: img.id, from: img.transectId, to: null });
    } else if (img.onEffort) {
      join(img, img.transectId);
    }
  }

  const returning = input.images.filter(
    (img) =>
      img.onEffort &&
      !img.wasOnEffort &&
      (!img.transectId || outsideTransects.has(img.transectId))
  );
  if (returning.length) {
    const regular = new Set(
      input.transects
        .filter((t) => !outsideTransects.has(t.id))
        .map((t) => t.id)
    );
    const isReturning = new Set(returning.map((img) => img.id));
    const anchorOf = (img: DesignImage) =>
      !isReturning.has(img.id) &&
      img.onEffort &&
      img.transectId &&
      regular.has(img.transectId)
        ? img.transectId
        : null;
    const byId = new Map(input.images.map((img) => [img.id, img]));
    // Excluded captures are kept so an exclusion does not break a line.
    const runs = new Map<number, DesignImage[]>();
    for (const { id, transectIndex } of detectTransects(input.images)) {
      let run = runs.get(transectIndex);
      if (!run) runs.set(transectIndex, (run = []));
      run.push(byId.get(id)!);
    }
    const lines = new Map<string, [DesignImage, DesignImage] | null>();
    const lineOf = (transectId: string) => {
      if (!lines.has(transectId)) {
        const flown = (members.get(transectId) ?? [])
          .filter(hasPosition)
          .sort((a, b) => a.timestamp - b.timestamp);
        const [a, b] = [flown[0], flown[flown.length - 1]];
        const distinct =
          a && (a.latitude !== b.latitude || a.longitude !== b.longitude);
        lines.set(transectId, distinct ? [a, b] : null);
      }
      return lines.get(transectId)!;
    };
    // Compare distance and time scores separately.
    const score = (img: DesignImage, anchor: DesignImage | null) => {
      const transectId = anchor && anchorOf(anchor);
      if (!transectId) return null;
      const line = lineOf(transectId);
      if (!line || !hasPosition(img)) {
        const d = Math.abs(img.timestamp - anchor.timestamp);
        return Number.isFinite(d) ? { transectId, onLine: false, d } : null;
      }
      const kx = 111320 * Math.cos((img.latitude! * Math.PI) / 180);
      const ky = 110574;
      const [a, b] = line.map((q) => [q.longitude! * kx, q.latitude! * ky]);
      const q = [img.longitude! * kx, img.latitude! * ky];
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(dx, dy);
      const d = Math.abs(dx * (q[1] - a[1]) - dy * (q[0] - a[0])) / len;
      return d <= TRACK_POSITION_TOLERANCE_METERS
        ? { transectId, onLine: true, d }
        : null;
    };
    const choose = (
      img: DesignImage,
      p: DesignImage | null,
      n: DesignImage | null
    ) => {
      const scored = [score(img, p), score(img, n)].filter((x) => x !== null);
      const onLine = scored.filter((x) => x.onLine);
      const pool = onLine.length ? onLine : scored;
      const best = Math.min(...pool.map((x) => x.d));
      const winners = new Set(
        pool.filter((x) => x.d === best).map((x) => x.transectId)
      );
      return winners.size === 1 ? [...winners][0] : null;
    };
    for (const run of runs.values()) {
      run.sort((a, b) => a.timestamp - b.timestamp);
      const before: (DesignImage | null)[] = [];
      let last: DesignImage | null = null;
      for (const img of run) {
        before.push(last);
        if (anchorOf(img)) last = img;
      }
      let next: DesignImage | null = null;
      for (let i = run.length - 1; i >= 0; i--) {
        const img = run[i];
        if (isReturning.has(img.id)) {
          const to = choose(img, before[i], next);
          if (to) {
            moves.set(img.id, { id: img.id, from: img.transectId, to });
            join(img, to);
          }
        }
        if (anchorOf(img)) next = img;
      }
    }
  }

  const locate = createStratumLocator(current.map((st) => st.coords));
  const tracks = current.map(() => [] as TrackPoint[][]);
  const transectStrata: StrataPlan['transectStrata'] = [];
  for (const transect of input.transects) {
    if (outsideTransects.has(transect.id) || current.length === 0) continue;
    const images = (members.get(transect.id) ?? []).sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const track = images.filter(hasPosition) as TrackPoint[];
    let index = track.length ? locate(track[0]) : null;
    if (index === null) {
      const kept = current.findIndex((st) => st.id === transect.stratumId);
      index = kept === -1 ? 0 : kept;
    }
    tracks[index].push(track);
    const stratumId = current[index].id;
    if (transect.stratumId !== stratumId) {
      transectStrata.push({ id: transect.id, stratumId });
    }
  }

  const strata: StratumStats[] = [];
  current.forEach((st, i) => {
    const metrics = stratumMetrics(st.coords, input.exclusions, tracks[i]);
    if (!metrics) return;
    strata.push({
      id: st.id,
      ...metrics,
    });
  });
  return {
    imageMoves: [...moves.values()],
    transectStrata,
    strata,
    deleteStrata: shaped.length ? shapeless.map((st) => st.id) : [],
  };
}
