import React from 'react';
import { ErrorBoundary as ReactErrorBoundary, FallbackProps } from 'react-error-boundary';
import { Box, Button, Typography, Paper, Alert, AlertTitle } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import HomeIcon from '@mui/icons-material/Home';
import BugReportIcon from '@mui/icons-material/BugReport';
import { useTranslation } from '../../i18n';

interface ErrorFallbackProps extends FallbackProps {
  title?: string;
  detailMessage?: string;
}

function ErrorFallback({ error, resetErrorBoundary, title, detailMessage }: ErrorFallbackProps) {
  const { t } = useTranslation('errors');
  const isDevelopment = import.meta.env.DEV;
  // react-error-boundary 6 types the thrown value as `unknown` (anything can
  // be thrown), so narrow it before reading Error fields.
  const thrownError = error instanceof Error ? error : undefined;
  const errorMessage = thrownError?.message ?? (typeof error === 'string' ? error : '');
  const errorStack = thrownError?.stack;

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px',
        p: 3,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 600,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <BugReportIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />

        <Typography variant="h4" gutterBottom color="error">
          {title ?? t('common:state.error')}
        </Typography>

        <Alert severity="error" sx={{ mt: 2, mb: 3, textAlign: 'left' }}>
          <AlertTitle>{t('boundary.details')}</AlertTitle>
          {detailMessage ?? (errorMessage || t('boundary.unexpected'))}
        </Alert>

        {isDevelopment && errorStack && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              bgcolor: 'var(--hotel-surface-sunken)',
              borderRadius: 1,
              textAlign: 'left',
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {errorStack}
            </Typography>
          </Box>
        )}

        <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<RefreshIcon />}
            onClick={resetErrorBoundary}
          >
            {t('common:actions.retry')}
          </Button>
          <Button
            variant="outlined"
            startIcon={<HomeIcon />}
            onClick={() => window.location.href = '/'}
          >
            {t('common:actions.goHome')}
          </Button>
        </Box>

        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            mt: 3,
            display: 'block'
          }}>
          {t('boundary.persistHint')}
        </Typography>
      </Paper>
    </Box>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  /**
   * Guest-facing replacement for the raw `error.message` in the fallback's
   * "Error Details" alert. Leave unset on staff/dev boundaries so the real
   * exception text keeps showing there.
   */
  detailMessage?: string;
  onError?: (error: unknown, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

export function ErrorBoundary({ children, title, detailMessage, onError, onReset }: ErrorBoundaryProps) {
  const handleError = (error: unknown, errorInfo: React.ErrorInfo) => {
    // Log error to console in development
    if (import.meta.env.DEV) {
      console.error('Error Boundary caught an error:', error, errorInfo);
    }

    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // In production, you might want to send this to an error tracking service
    // Example: Sentry.captureException(error, { extra: errorInfo });
  };

  const handleReset = () => {
    // Call custom reset handler if provided
    if (onReset) {
      onReset();
    }
  };

  return (
    <ReactErrorBoundary
      FallbackComponent={(props) => <ErrorFallback {...props} title={title} detailMessage={detailMessage} />}
      onError={handleError}
      onReset={handleReset}
    >
      {children}
    </ReactErrorBoundary>
  );
}

// Page-level error boundary with custom styling
export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('errors');
  return (
    <ErrorBoundary
      title={t('boundary.page')}
      onError={(error, errorInfo) => {
        console.error('Page Error:', error, errorInfo);
      }}
      onReset={() => {
        // Reload only — sessionStorage.clear() would also destroy the
        // guest-portal session token and other unrelated session state.
        window.location.reload();
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

// Component-level error boundary (less intrusive)
export function ComponentErrorBoundary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('errors');
  return (
    <ErrorBoundary
      title={t('boundary.component')}
      onError={(error) => {
        console.warn('Component Error:', error);
      }}
      onReset={() => {
        // For a failed lazy import, re-rendering replays the cached rejection
        // — only a document reload clears the browser's module-map entry.
        window.location.reload();
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
