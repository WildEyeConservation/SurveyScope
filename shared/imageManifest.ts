export interface ManifestImage {
  id: string;
  cameraId: string | null;
  originalPath: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude_agl: number | null;
  altitude_wgs84: number | null;
  timestamp: number | null;
}

export interface ManifestChunk {
  v: 1;
  ids: string[];
  cameras: string[];
  camera: number[];
  dirs: string[];
  dir: number[];
  names: string[];
  lat: (number | null)[];
  lon: (number | null)[];
  agl: (number | null)[];
  wgs: (number | null)[];
  // Each value is the difference from the previous non-null timestamp.
  ts: (number | null)[];
}

export const MANIFEST_FIELDS = [
  'id',
  'cameraId',
  'originalPath',
  'latitude',
  'longitude',
  'altitude_agl',
  'altitude_wgs84',
  'timestamp',
] as const;

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function indexer() {
  const values: string[] = [];
  const lookup = new Map<string, number>();
  return {
    values,
    index(value: string) {
      let i = lookup.get(value);
      if (i === undefined) {
        i = values.length;
        values.push(value);
        lookup.set(value, i);
      }
      return i;
    },
  };
}

// Sorting by time keeps the timestamp deltas small; callers do not rely on order.
export function encodeManifest(rows: ManifestImage[]): ManifestChunk {
  const sorted = [...rows].sort(
    (a, b) =>
      (num(a.timestamp) ?? Infinity) - (num(b.timestamp) ?? Infinity) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const cameras = indexer();
  const dirs = indexer();
  const chunk: ManifestChunk = {
    v: 1,
    ids: [],
    cameras: cameras.values,
    camera: [],
    dirs: dirs.values,
    dir: [],
    names: [],
    lat: [],
    lon: [],
    agl: [],
    wgs: [],
    ts: [],
  };
  let previous = 0;
  for (const row of sorted) {
    chunk.ids.push(row.id);
    chunk.camera.push(row.cameraId ? cameras.index(row.cameraId) : -1);
    const path = row.originalPath;
    if (typeof path === 'string') {
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
      chunk.dir.push(dirs.index(path.slice(0, cut)));
      chunk.names.push(path.slice(cut));
    } else {
      chunk.dir.push(-1);
      chunk.names.push('');
    }
    chunk.lat.push(num(row.latitude));
    chunk.lon.push(num(row.longitude));
    chunk.agl.push(num(row.altitude_agl));
    chunk.wgs.push(num(row.altitude_wgs84));
    const ts = num(row.timestamp);
    chunk.ts.push(ts === null ? null : ts - previous);
    if (ts !== null) previous = ts;
  }
  return chunk;
}

export function decodeManifest(chunk: ManifestChunk): ManifestImage[] {
  if (chunk.v !== 1) throw new Error(`Unsupported manifest version ${chunk.v}`);
  let previous = 0;
  return chunk.ids.map((id, i) => {
    const delta = chunk.ts[i];
    const timestamp = delta === null ? null : previous + delta;
    if (timestamp !== null) previous = timestamp;
    return {
      id,
      cameraId: chunk.camera[i] < 0 ? null : chunk.cameras[chunk.camera[i]],
      originalPath:
        chunk.dir[i] < 0 ? null : chunk.dirs[chunk.dir[i]] + chunk.names[i],
      latitude: chunk.lat[i],
      longitude: chunk.lon[i],
      altitude_agl: chunk.agl[i],
      altitude_wgs84: chunk.wgs[i],
      timestamp,
    };
  });
}
