import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  useTable,
  type PaginationState,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Inbox,
  type LucideIcon,
} from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { dataTableFeatures, type DataColumn } from './dataTableFeatures';

export type { DataColumn } from './dataTableFeatures';

export interface DataColumnMeta {
  className?: string;
  headerClassName?: string;
  description?: string;
  style?: CSSProperties;
}

const PAGE_SIZE_KEY = 'tableItemsPerPage';
const PAGE_SIZES = [5, 10, 25, 50, 100];
const ALL_ROWS: PaginationState = {
  pageIndex: 0,
  pageSize: Number.MAX_SAFE_INTEGER,
};

function storedPageSize(fallback: number) {
  const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
  return stored > 0 ? stored : fallback;
}

export interface DataTableProps<T extends RowData> {
  columns: DataColumn<T>[];
  data: T[];
  getRowId?: (row: T) => string;
  initialSorting?: SortingState;
  /** Rows per page until the user picks another size; false shows every row. */
  pageSize?: number | false;
  emptyMessage?: ReactNode;
  emptyIcon?: LucideIcon;
  loading?: boolean;
  loadingMessage?: ReactNode;
  minWidth?: number;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  renderBelowRow?: (row: T) => ReactNode;
  onRowHover?: (id: string | null) => void;
  highlightedRowIds?: Set<string>;
  hideHeader?: boolean;
  /** Totals row kept out of sorting and paging. */
  footer?: ReactNode[];
}

export default function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  initialSorting = [],
  pageSize = 10,
  emptyMessage = 'Nothing to show.',
  emptyIcon: EmptyIcon = Inbox,
  loading = false,
  loadingMessage = 'Loading...',
  minWidth,
  className,
  rowClassName,
  renderBelowRow,
  onRowHover,
  highlightedRowIds,
  hideHeader = false,
  footer,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [pagination, setPagination] = useState<PaginationState>(() =>
    pageSize ? { pageIndex: 0, pageSize: storedPageSize(pageSize) } : ALL_ROWS,
  );

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    // Callers rebuild `data` on refresh, which would otherwise reset the page.
    autoResetPageIndex: false,
  });

  const [rowCount, setRowCount] = useState(data.length);
  if (rowCount !== data.length) {
    setRowCount(data.length);
    if (pagination.pageIndex !== 0)
      setPagination((p) => ({ ...p, pageIndex: 0 }));
  }

  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const pageCount = Math.max(table.getPageCount(), 1);
  const message = loading ? loadingMessage : rows.length ? null : emptyMessage;

  return (
    <div className='flex flex-col gap-2'>
      <div
        className={cn(
          'overflow-x-auto border border-dark',
          // The frame draws the outer edge, so cells skip theirs.
          '[&_thead_tr:first-child>*]:border-t-0 [&_tr:last-child>*]:border-b-0 [&_tr>*:first-child]:border-l-0 [&_tr>*:last-child]:border-r-0',
          className,
        )}
      >
        <Table
          striped
          hover
          bordered
          className='mb-0'
          style={minWidth ? { minWidth } : undefined}
        >
          <TableHeader className={cn(hideHeader && 'hidden')}>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    DataColumnMeta | undefined;
                  const label = header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  );
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const Icon = !sorted
                    ? ArrowUpDown
                    : sorted === 'asc'
                      ? ArrowUp
                      : ArrowDown;
                  const content = sortable ? (
                    <button
                      type='button'
                      onClick={header.column.getToggleSortingHandler()}
                      className='inline-flex items-center gap-1 text-left font-bold whitespace-nowrap hover:text-white'
                    >
                      {label}
                      <Icon
                        className={cn('size-3.5', !sorted && 'opacity-40')}
                      />
                    </button>
                  ) : (
                    label
                  );
                  return (
                    <TableHead
                      key={header.id}
                      style={meta?.style}
                      className={cn(
                        'bg-dark whitespace-nowrap',
                        meta?.headerClassName ?? meta?.className,
                      )}
                    >
                      {meta?.description ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className='inline-flex cursor-help'>
                              {content}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className='max-w-64'>
                            {meta.description}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        content
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {message ? (
              <TableRow>
                <TableCell
                  colSpan={columnCount}
                  className='bg-[#6F7B89] py-10 text-center text-muted-foreground'
                >
                  <div className='flex flex-col items-center gap-2'>
                    {!loading && <EmptyIcon size={28} className='opacity-70' />}
                    {message}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const highlighted = highlightedRowIds?.has(row.id);
                const below = renderBelowRow?.(row.original);
                return [
                  <TableRow
                    key={row.id}
                    className={cn('align-middle', rowClassName?.(row.original))}
                    onMouseEnter={onRowHover && (() => onRowHover(row.id))}
                    onMouseLeave={onRowHover && (() => onRowHover(null))}
                  >
                    {row.getAllCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as
                        DataColumnMeta | undefined;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            highlighted ? 'bg-[#8794A3]' : 'bg-[#6F7B89]',
                            meta?.className,
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>,
                  below ? (
                    <TableRow key={`${row.id}:below`}>
                      <TableCell
                        colSpan={columnCount}
                        className='bg-[#6F7B89] p-0'
                      >
                        {below}
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })
            )}
          </TableBody>
          {footer && !message && (
            <TableFooter>
              <TableRow>
                {footer.map((cell, index) => (
                  <TableCell key={index} className='bg-[#6F7B89] font-bold'>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      {pageSize && data.length > PAGE_SIZES[0] && (
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <label htmlFor='rowsPerPage' className='mb-0'>
              Rows per page:
            </label>
            <NativeSelect
              id='rowsPerPage'
              value={pagination.pageSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                localStorage.setItem(PAGE_SIZE_KEY, String(size));
                setPagination({ pageIndex: 0, pageSize: size });
              }}
              style={{ width: 'auto' }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className='flex items-center gap-2'>
            <span>
              Page {pagination.pageIndex + 1} of {pageCount}
            </span>
            <Button
              variant='info'
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              &lt;
            </Button>
            <Button
              variant='info'
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              &gt;
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
