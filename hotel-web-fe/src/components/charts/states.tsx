/** Chart loading / empty / error states — one visual language for every chart. */
import React from 'react';
import { Alert, Box, Skeleton, Typography } from '@mui/material';
import { useTranslation } from '../../i18n';

const centerSx = {
  height: '100%',
  minHeight: 140,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
  gap: 0.5,
} as const;

export const ChartLoading: React.FC = () => {
  const { t } = useTranslation('common');
  return (
    <Skeleton
      variant="rounded"
      width="100%"
      height="100%"
      sx={{ minHeight: 160 }}
      aria-label={t('charts.loading')}
    />
  );
};

export const ChartEmpty: React.FC<{ message?: string }> = ({ message }) => {
  const { t } = useTranslation('common');
  return (
    <Box sx={centerSx} role="status">
      <Typography variant="body2" color="text.secondary">
        {message ?? t('charts.emptyPeriod')}
      </Typography>
    </Box>
  );
};

export const ChartError: React.FC<{ message?: string; onRetry?: () => void }> = ({
  message,
  onRetry,
}) => {
  const { t } = useTranslation('common');
  return (
    <Box sx={{ ...centerSx, px: 2 }}>
      <Alert
        severity="error"
        variant="outlined"
        action={
          onRetry ? (
            <button type="button" onClick={onRetry} style={{ cursor: 'pointer' }}>
              {t('state.retry')}
            </button>
          ) : undefined
        }
      >
        {message ?? t('charts.loadFailed')}
      </Alert>
    </Box>
  );
};

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
