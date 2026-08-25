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

  return (
    <TableContainer component={Paper} sx={{ borderRadius: 2 }} {...containerProps}>
      <Table>
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
          {rows.length === 0 ? (
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
      {enablePagination && rows.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, p: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          </Typography>
          <Box
            component="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            sx={{ px: 1, py: 0.5, cursor: 'pointer', border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', '&:disabled': { opacity: 0.4, cursor: 'default' } }}
          >
            ‹
          </Box>
          <Box
            component="button"
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
