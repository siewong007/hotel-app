import type { RowData } from '@tanstack/react-table';

/**
 * Column meta contract used by the shared data table. Columns declare these
 * through `columnDef.meta`; `DataTable` reads them without casts thanks to
 * this augmentation.
 */
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Horizontal alignment for the header and cell renderers. */
    align?: 'left' | 'center' | 'right';
    /** Suppress row-click navigation when interacting with this cell. */
    stopRowClick?: boolean;
  }
}

export {};
