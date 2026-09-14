/** Chart loading / empty / error states — one visual language for every chart. */
import React from 'react';
import { Alert, Box, Skeleton, Typography } from '@mui/material';

const centerSx = {
  height: '100%',
  minHeight: 140,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  gap: 0.5,
} as const;

export const ChartLoading: React.FC = () => (
  <Skeleton
    variant="rounded"
    width="100%"
    height="100%"
    sx={{ minHeight: 160 }}
    aria-label="Loading chart"
  />
);

export const ChartEmpty: React.FC<{ message?: string }> = ({ message = 'No data for this period' }) => (
  <Box sx={centerSx} role="status">
    <Typography variant="body2" color="text.secondary">
      {message}
    </Typography>
  </Box>
);

export const ChartError: React.FC<{ message?: string; onRetry?: () => void }> = ({
  message = 'Chart data failed to load',
  onRetry,
}) => (
  <Box sx={{ ...centerSx, px: 2 }}>
    <Alert
      severity="error"
      variant="outlined"
      action={
        onRetry ? (
          <button type="button" onClick={onRetry} style={{ cursor: 'pointer' }}>
            Retry
          </button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  </Box>
);

/** Picks the state to render, or `children` when data is present. */
export const ChartStateGate: React.FC<{
  loading?: boolean;
  error?: string | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}> = ({ loading, error, isEmpty, emptyMessage, onRetry, children }) => {
  if (loading) return <ChartLoading />;
  if (error) return <ChartError message={error} onRetry={onRetry} />;
  if (isEmpty) return <ChartEmpty message={emptyMessage} />;
  return <>{children}</>;
};
