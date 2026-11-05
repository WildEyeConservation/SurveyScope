import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
});

// Columns in one table hold different value types.
export type DataColumn<T extends RowData> = ColumnDef<
  typeof dataTableFeatures,
  T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>;
