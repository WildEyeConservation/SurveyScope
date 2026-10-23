export type ColumnKind =
  | 'dict'
  | 'path'
  | 'num'
  | 'delta'
  | 'str'
  | 'bool'
  | 'floats';

export type ValueOfKind<K> = K extends 'num' | 'delta'
  ? number
  : K extends 'bool'
  ? boolean
  : K extends 'floats'
  ? (number | null)[]
  : string;

type Column =
  | { values: string[]; index: number[] }
  | { dirs: string[]; dir: number[]; names: string[] }
  | unknown[];

export interface RowChunk {
  v: 3;
  n: number;
  columns: Record<string, Column>;
}

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown) => (typeof value === 'string' ? value : null);
const bool = (value: unknown) => (typeof value === 'boolean' ? value : null);
const floats = (value: unknown) =>
  Array.isArray(value) ? value.map(num) : null;

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

function encodeColumn(kind: ColumnKind, values: unknown[]): Column {
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
    case 'bool':
      return values.map(bool);
    case 'floats':
      return values.map(floats);
  }
}

function decodeColumn(kind: ColumnKind, column: Column, n: number): unknown[] {
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
      return Array.isArray(column) ? column : new Array(n).fill(null);
  }
}

// Sorting by sortBy keeps its deltas small; callers do not rely on order.
export function encodeRows(
  rows: Record<string, unknown>[],
  kinds: Record<string, ColumnKind>,
  fields: readonly string[],
  sortBy?: string
): RowChunk {
  const sorted =
    sortBy && fields.includes(sortBy)
      ? [...rows].sort(
          (a, b) => (num(a[sortBy]) ?? Infinity) - (num(b[sortBy]) ?? Infinity)
        )
      : rows;
  const columns: RowChunk['columns'] = {};
  for (const field of fields) {
    columns[field] = encodeColumn(
      kinds[field],
      sorted.map((row) => row[field])
    );
  }
  return { v: 3, n: rows.length, columns };
}

export function decodeRows(
  chunk: RowChunk,
  kinds: Record<string, ColumnKind>
): Record<string, unknown>[] {
  if (chunk.v !== 3)
    throw new Error(`Unsupported row chunk version ${chunk.v}`);
  const rows = Array.from(
    { length: chunk.n },
    () => ({} as Record<string, unknown>)
  );
  for (const [field, column] of Object.entries(chunk.columns)) {
    if (!Object.prototype.hasOwnProperty.call(kinds, field)) continue;
    const values = decodeColumn(kinds[field], column, chunk.n);
    values.forEach((value, i) => (rows[i][field] = value));
  }
  return rows;
}
