import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  Box,
  Typography,
  Skeleton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  flexRender,
  useTable,
  tableFeatures,
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  createSortedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  type ColumnDef as TanStackColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowData,
} from '@tanstack/react-table';

/**
 * Feature sets stitched into the shared table. Both register
 * `rowPaginationFeature` so pagination state and APIs exist on either table;
 * only the paginated bundle registers the row model that actually slices rows
 * — the row model cannot be toggled after registration, so it is what makes
 * pagination opt-in per table.
 */
const baseTableFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
});

const paginatedTableFeatures = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

/**
 * Column definitions are authored before a table instance exists, so they are
 * feature-agnostic (`any` TFeatures) and pick up `meta` typing from the global
 * `ColumnMeta` augmentation in `src/types/tanstack-table.d.ts`.
 */
export type ColumnDef<TData extends RowData, TValue = unknown> = TanStackColumnDef<any, TData, TValue>;

type DataTableFeatures = typeof baseTableFeatures | typeof paginatedTableFeatures;

export interface DataTableProps<TData extends RowData> {
  data: TData[];
  columns: ColumnDef<TData, any>[];
  emptyMessage?: React.ReactNode;
  loading?: boolean;
  loadingRowCount?: number;
  /**
   * Below the `sm` breakpoint the table swaps to a card list — wide tables are
   * unusable on phones. Supplying this renderer opts the surface in; without
   * it the table scrolls horizontally as before.
   */
  renderMobileCard?: (row: TData) => React.ReactNode;
  globalFilter?: string;
  onRowClick?: (row: TData) => void;
  initialSorting?: SortingState;
  initialColumnFilters?: ColumnFiltersState;
  pageSize?: number;
  enablePagination?: boolean;
  containerProps?: React.ComponentProps<typeof TableContainer>;
  getRowId?: (row: TData, index: number) => string;
}

export function DataTable<TData extends RowData>({
  data,
  columns,
  emptyMessage = 'No rows',
  loading = false,
  loadingRowCount = 6,
  renderMobileCard,
  globalFilter,
  onRowClick,
  initialSorting,
  initialColumnFilters,
  pageSize,
  enablePagination = false,
  containerProps,
  getRowId,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting ?? []);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(initialColumnFilters ?? []);

  const table = useTable<DataTableFeatures, TData>({
    features: enablePagination ? paginatedTableFeatures : baseTableFeatures,
    data,
    columns: columns as TanStackColumnDef<DataTableFeatures, TData>[],
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    initialState: enablePagination && pageSize ? { pagination: { pageSize, pageIndex: 0 } } : undefined,
    getRowId,
  });

  const rows = table.getRowModel().rows;
  const theme = useTheme();
  const isMobileList = useMediaQuery(theme.breakpoints.down('sm')) && Boolean(renderMobileCard);

  const emptyState = (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      {typeof emptyMessage === 'string' ? (
        <Typography sx={{ color: "text.secondary" }}>{emptyMessage}</Typography>
      ) : (
        emptyMessage
      )}
    </Box>
  );

  return (
    <TableContainer component={Paper} sx={{ borderRadius: 2 }} {...containerProps}>
      {isMobileList ? (
        <Box aria-busy={loading || undefined}>
          {loading ? (
            Array.from({ length: Math.min(loadingRowCount, 4) }).map((_, i) => (
              <Box key={`loading-card-${i}`} sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Skeleton variant="text" width="55%" sx={{ fontSize: '1rem' }} />
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="40%" />
              </Box>
            ))
          ) : rows.length === 0 ? (
            emptyState
          ) : (
            rows.map((row) => (
              <Box
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  cursor: onRowClick ? 'pointer' : undefined,
                  '&:last-child': { borderBottom: 0 },
                  ...(onRowClick && { '&:hover': { bgcolor: 'action.hover' } }),
                }}
              >
                {renderMobileCard!(row.original)}
              </Box>
            ))
          )}
        </Box>
      ) : (
      <Table aria-busy={loading || undefined}>
        <TableHead>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} sx={{ bgcolor: 'grey.50' }}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <TableCell
                    key={header.id}
                    align={header.column.columnDef.meta?.align ?? 'left'}
                    sx={{ fontWeight: 600 }}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <TableSortLabel
                        active={Boolean(sortDir)}
                        direction={sortDir === 'desc' ? 'desc' : 'asc'}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </TableSortLabel>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {loading ? (
            Array.from({ length: loadingRowCount }).map((_, rowIndex) => (
              <TableRow key={`loading-${rowIndex}`}>
                {table.getAllLeafColumns().map((column, colIndex) => (
                  <TableCell key={column.id} align={column.columnDef.meta?.align ?? 'left'}>
                    <Skeleton
                      variant="text"
                      width={`${88 - ((rowIndex + colIndex) % 3) * 16}%`}
                      sx={{ fontSize: '0.9rem' }}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ py: 4 }}>
                {typeof emptyMessage === 'string' ? (
                  <Typography sx={{
                    color: "text.secondary"
                  }}>{emptyMessage}</Typography>
                ) : (
                  emptyMessage
                )}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                hover={Boolean(onRowClick)}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                sx={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    align={cell.column.columnDef.meta?.align ?? 'left'}
                    onClick={cell.column.columnDef.meta?.stopRowClick ? (e) => e.stopPropagation() : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      )}
      {enablePagination && rows.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Page {table.state.pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </Typography>
          <Box
            component="button"
            aria-label="Previous page"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            sx={{ px: 1, py: 0.5, cursor: 'pointer', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', '&:disabled': { opacity: 0.4, cursor: 'default' } }}
          >
            ‹
          </Box>
          <Box
            component="button"
            aria-label="Next page"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            sx={{ px: 1, py: 0.5, cursor: 'pointer', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', '&:disabled': { opacity: 0.4, cursor: 'default' } }}
          >
            ›
          </Box>
        </Box>
      )}
    </TableContainer>
  );
}
