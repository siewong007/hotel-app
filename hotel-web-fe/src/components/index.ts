// Components Barrel Export
// Re-exports all shared components for clean imports

// Common components
export { AnimatedRoute } from './common/AnimatedRoute';
export { ErrorBoundary, PageErrorBoundary, ComponentErrorBoundary } from './common/ErrorBoundary';
export { StatusPage } from './common/StatusPage';
export { ConfirmDialog } from './common/ConfirmDialog';
export type { ConfirmDialogProps, ConfirmOptions, ConfirmSeverity } from './common/ConfirmDialog';
export { ConfirmProvider, useConfirm } from './common/ConfirmProvider';
export { default as HotelSpinner } from './common/HotelSpinner';
export { default as LoadingSpinner } from './common/LoadingSpinner';
export { default as ModernDatePicker } from './common/ModernDatePicker';
export { default as StatCard } from './common/StatCard';
export type { StatCardProps, StatCardTrend } from './common/StatCard';
export { default as TabPanel, getTabA11yProps } from './common/TabPanel';
export type { TabPanelProps } from './common/TabPanel';
export { default as StatusChip, statusTone } from './common/StatusChip';
export type { StatusChipProps, StatusTone } from './common/StatusChip';
export { default as MoneyText } from './common/MoneyText';
export type { MoneyTextProps } from './common/MoneyText';
export { default as DateText, DateRangeText } from './common/DateText';
export type { DateTextProps, DateRangeTextProps } from './common/DateText';
export { default as EmptyState } from './common/EmptyState';
export type { EmptyStateProps } from './common/EmptyState';
export { default as PageHeader } from './common/PageHeader';
export type { PageHeaderProps } from './common/PageHeader';
export { default as StatStrip } from './common/StatStrip';
export type { StatStripProps, StatStripItem } from './common/StatStrip';

// Data table primitives
export { DataTable } from './data-table/DataTable';
export type { DataTableProps, ColumnDef } from './data-table/DataTable';
