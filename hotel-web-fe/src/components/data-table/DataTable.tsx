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
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type Row,
} from '@tanstack/react-table';

export interface DataTableProps<TData> {
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

export function DataTable<TData>({
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

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    initialState: enablePagination && pageSize ? { pagination: { pageSize, pageIndex: 0 } } : undefined,
    getRowId,
  });

  const rows: Row<TData>[] = table.getRowModel().rows;
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
                {table.getVisibleLeafColumns().map((column, colIndex) => (
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
                {row.getVisibleCells().map((cell) => (
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
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
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

export type { ColumnDef };
