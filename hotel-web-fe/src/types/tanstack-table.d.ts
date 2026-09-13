import type { CellData, RowData, TableFeatures } from '@tanstack/table-core';

/**
 * Column meta contract used by the shared data table. Columns declare these
 * through `columnDef.meta`; `DataTable` reads them without casts thanks to
 * this augmentation. In TanStack Table v9 the interface lives in
 * `@tanstack/table-core` (re-exported through `@tanstack/react-table`) and
 * carries the table's feature set as its first type parameter — feature-typed
 * tables can instead declare meta via the `columnMeta` slot on
 * `tableFeatures({...})`; the global augmentation remains the fallback for
 * feature-agnostic `ColumnDef`s.
 */
declare module '@tanstack/table-core' {
  interface ColumnMeta<TFeatures extends TableFeatures, TData extends RowData, TValue extends CellData = CellData> {
    /** Horizontal alignment for the header and cell renderers. */
    align?: 'left' | 'center' | 'right';
    /** Suppress row-click navigation when interacting with this cell. */
    stopRowClick?: boolean;
  }
}

export {};
