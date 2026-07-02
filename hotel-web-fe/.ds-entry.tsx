// Scoped design-system entry: exports only the reusable shared primitives
// (not the full app) plus the theme provider. Bundled to window.HotelDS.
export { default as StatCard } from './src/components/common/StatCard';
export { default as TabPanel } from './src/components/common/TabPanel';
export { default as ModernDatePicker } from './src/components/common/ModernDatePicker';
export { default as HotelSpinner } from './src/components/common/HotelSpinner';
export { default as LoadingSpinner } from './src/components/common/LoadingSpinner';
export { DataTable } from './src/components/data-table/DataTable';
export { AppThemeProvider } from './.ds-provider';

// MUI primitives re-exported so preview cards can compose scaffolding that
// shares the DS bundle's emotion instance — otherwise MUI imported fresh in a
// preview renders with the default (blue) theme instead of the hotel teal.
export { Box, Paper, Typography, Tabs, Tab, Chip } from '@mui/material';
