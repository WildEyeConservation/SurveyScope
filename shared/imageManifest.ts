const FIELD_KINDS = {
  cameraId: 'dict',
  transectId: 'dict',
  boundaryStatus: 'dict',
  originalPath: 'path',
  latitude: 'num',
  longitude: 'num',
  altitude_agl: 'num',
  altitude_wgs84: 'num',
  width: 'num',
  height: 'num',
  timestamp: 'delta',
  phash: 'str',
} as const;

export type ManifestField = keyof typeof FIELD_KINDS;
export const MANIFEST_FIELDS = Object.keys(FIELD_KINDS) as ManifestField[];

type Kind = (typeof FIELD_KINDS)[ManifestField];
type ValueOf<K extends Kind> = K extends 'num' | 'delta' ? number : string;

export type ManifestImage = { id: string } & {
  [F in ManifestField]: ValueOf<(typeof FIELD_KINDS)[F]> | null;
};
export type ManifestRow<F extends ManifestField> = Pick<
  ManifestImage,
  'id' | F
>;

type Column =
  | { values: string[]; index: number[] }
  | { dirs: string[]; dir: number[]; names: string[] }
  | (number | null)[]
  | (string | null)[];

export interface ManifestChunk {
  v: 2;
  ids: string[];
  columns: Partial<Record<ManifestField, Column>>;
}

export function isManifestField(field: unknown): field is ManifestField {
  return (
    typeof field === 'string' &&
    Object.prototype.hasOwnProperty.call(FIELD_KINDS, field)
  );
}

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown) => (typeof value === 'string' ? value : null);

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

function encodeColumn(kind: Kind, values: unknown[]): Column {
  switch (kind) {
    case 'dict': {
      const dict = indexer();
      const index = values.map((v) => {
        const s = str(v);
        return s === null ? -1 : dict.index(s);
      });
      return { values: dict.values, index };
    }
    case 'path': {
      const dirs = indexer();
      const dir: number[] = [];
      const names: string[] = [];
      for (const v of values) {
        const path = str(v);
        if (path === null) {
          dir.push(-1);
          names.push('');
          continue;
        }
        const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
        dir.push(dirs.index(path.slice(0, cut)));
        names.push(path.slice(cut));
      }
      return { dirs: dirs.values, dir, names };
    }
    case 'num':
      return values.map(num);
    case 'delta': {
      let previous = 0;
      return values.map((v) => {
        const n = num(v);
        if (n === null) return null;
        const delta = n - previous;
        previous = n;
        return delta;
      });
    }
    case 'str':
      return values.map(str);
  }
}

function decodeColumn(kind: Kind, column: Column): unknown[] {
  switch (kind) {
    case 'dict': {
      const { values, index } = column as { values: string[]; index: number[] };
      return index.map((i) => (i < 0 ? null : values[i]));
    }
    case 'path': {
      const { dirs, dir, names } = column as {
        dirs: string[];
        dir: number[];
        names: string[];
      };
      return dir.map((i, row) => (i < 0 ? null : dirs[i] + names[row]));
    }
    case 'delta': {
      let previous = 0;
      return (column as (number | null)[]).map((delta) => {
        if (delta === null) return null;
        previous += delta;
        return previous;
      });
    }
    default:
      return column as unknown[];
  }
}

// Sorting by time keeps the timestamp deltas small; callers do not rely on order.
export function encodeManifest(
  rows: Record<string, unknown>[],
  fields: readonly ManifestField[]
): ManifestChunk {
  const sorted = fields.includes('timestamp')
    ? [...rows].sort(
        (a, b) =>
          (num(a.timestamp) ?? Infinity) - (num(b.timestamp) ?? Infinity)
      )
    : rows;
  const columns: ManifestChunk['columns'] = {};
  for (const field of fields) {
    columns[field] = encodeColumn(
      FIELD_KINDS[field],
      sorted.map((row) => row[field])
    );
  }
  return { v: 2, ids: sorted.map((row) => String(row.id)), columns };
}

export function decodeManifest(chunk: ManifestChunk): ManifestImage[] {
  if (chunk.v !== 2) throw new Error(`Unsupported manifest version ${chunk.v}`);
  const rows = chunk.ids.map((id) => ({ id } as Record<string, unknown>));
  for (const [field, column] of Object.entries(chunk.columns)) {
    if (!isManifestField(field) || !column) continue;
    const values = decodeColumn(FIELD_KINDS[field], column);
    values.forEach((value, i) => (rows[i][field] = value));
  }
  return rows as ManifestImage[];
}
