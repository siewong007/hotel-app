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
export { BottomSheet } from './common/BottomSheet';
export type { BottomSheetProps } from './common/BottomSheet';
export { FilterSheet } from './common/FilterSheet';
export type { FilterSheetProps } from './common/FilterSheet';
export { SearchAndFilters } from './common/SearchAndFilters';
export type { SearchAndFiltersProps } from './common/SearchAndFilters';
export { ActionsMenu } from './common/ActionsMenu';
export type { ActionsMenuProps, ActionMenuItem } from './common/ActionsMenu';
export { default as PageHeader } from './common/PageHeader';
export type { PageHeaderProps } from './common/PageHeader';
export { default as StatStrip } from './common/StatStrip';
export type { StatStripProps, StatStripItem } from './common/StatStrip';
export { CollapsibleSection } from './common/CollapsibleSection';
export type { CollapsibleSectionProps } from './common/CollapsibleSection';
export { ResponsiveTabs } from './common/ResponsiveTabs';
export type { ResponsiveTabsProps, ResponsiveTabItem } from './common/ResponsiveTabs';
export { StickyActionBar } from './common/StickyActionBar';
export type { StickyActionBarProps } from './common/StickyActionBar';

// Data table primitives
export { DataTable } from './data-table/DataTable';
export type { DataTableProps, ColumnDef } from './data-table/DataTable';
export { MobileCardRow } from './data-table/MobileCardRow';
export type { MobileCardRowProps } from './data-table/MobileCardRow';
