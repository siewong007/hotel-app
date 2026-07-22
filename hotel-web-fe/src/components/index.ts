// Components Barrel Export
// Re-exports all shared components for clean imports

// Common components
export { AnimatedRoute } from './common/AnimatedRoute';
export { ErrorBoundary, PageErrorBoundary, ComponentErrorBoundary } from './common/ErrorBoundary';
export { StatusPage } from './common/StatusPage';
export { default as HotelSpinner } from './common/HotelSpinner';
export { default as LoadingSpinner } from './common/LoadingSpinner';
export { default as ModernDatePicker } from './common/ModernDatePicker';
export { default as StatCard } from './common/StatCard';
export type { StatCardProps, StatCardTrend } from './common/StatCard';
export { default as TabPanel, getTabA11yProps } from './common/TabPanel';
export type { TabPanelProps } from './common/TabPanel';

// Data table primitives
export { DataTable } from './data-table/DataTable';
export type { DataTableProps, ColumnDef } from './data-table/DataTable';
