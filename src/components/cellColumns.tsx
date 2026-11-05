import type { CSSProperties, ReactNode } from 'react';
import type { DataColumn, DataColumnMeta } from './DataTable';

export interface CellRow {
  id: string;
  cells: ReactNode[];
}

export interface CellHeading {
  content: string;
  sort?: boolean;
  description?: string;
  className?: string;
  style?: CSSProperties;
}

type SortRow = { getValue: (columnId: string) => unknown };

const sortable = (value: ReactNode): string | number =>
  typeof value === 'number' || typeof value === 'string' ? value : '';

function compare(a: string | number, b: string | number) {
  const x = typeof a === 'string' && /^-?\d+(\.\d+)?$/.test(a) ? Number(a) : a;
  const y = typeof b === 'string' && /^-?\d+(\.\d+)?$/.test(b) ? Number(b) : b;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  return String(x).localeCompare(String(y), undefined, { numeric: true });
}

// Keep the renderer identity stable to avoid remounting cells.
function renderCell({
  row,
  column,
}: {
  row: { original: CellRow };
  column: { id: string };
}) {
  return row.original.cells[Number(column.id)];
}

export function columnsFromHeadings(
  headings: CellHeading[],
): DataColumn<CellRow>[] {
  return headings.map((heading, index) => ({
    id: `${index}`,
    header: heading.content,
    accessorFn: (row: CellRow) => sortable(row.cells[index]),
    cell: renderCell,
    enableSorting: !!heading.sort,
    sortingFn: (a: SortRow, b: SortRow) =>
      compare(
        a.getValue(`${index}`) as string | number,
        b.getValue(`${index}`) as string | number,
      ),
    meta: {
      description: heading.description,
      className: heading.className,
      style: heading.style,
    } satisfies DataColumnMeta,
  }));
}

export function cellRows(
  rows: { id: string | number; rowData: ReactNode[] }[],
): CellRow[] {
  return rows.map((row) => ({ id: String(row.id), cells: row.rowData }));
}
