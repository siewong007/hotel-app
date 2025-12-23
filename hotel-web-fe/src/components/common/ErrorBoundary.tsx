import React from 'react';
import { ErrorBoundary as ReactErrorBoundary, FallbackProps } from 'react-error-boundary';
import { Box, Button, Typography, Paper, Alert, AlertTitle } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import HomeIcon from '@mui/icons-material/Home';
import BugReportIcon from '@mui/icons-material/BugReport';

interface ErrorFallbackProps extends FallbackProps {
  title?: string;
}

function ErrorFallback({ error, resetErrorBoundary, title = 'Something went wrong' }: ErrorFallbackProps) {
  const isDevelopment = process.env.NODE_ENV === 'development';

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
          {title}
        </Typography>

        <Alert severity="error" sx={{ mt: 2, mb: 3, textAlign: 'left' }}>
          <AlertTitle>Error Details</AlertTitle>
          {error.message || 'An unexpected error occurred'}
        </Alert>

        {isDevelopment && error.stack && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              bgcolor: 'grey.100',
              borderRadius: 1,
              textAlign: 'left',
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            <Typography variant="caption" component="pre" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {error.stack}
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
            Try Again
          </Button>
          <Button
            variant="outlined"
            startIcon={<HomeIcon />}
            onClick={() => window.location.href = '/'}
          >
            Go Home
          </Button>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
          If this problem persists, please contact support
        </Typography>
      </Paper>
    </Box>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  onReset?: () => void;
}

export function ErrorBoundary({ children, title, onError, onReset }: ErrorBoundaryProps) {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
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
      FallbackComponent={(props) => <ErrorFallback {...props} title={title} />}
      onError={handleError}
      onReset={handleReset}
    >
      {children}
    </ReactErrorBoundary>
  );
}

// Page-level error boundary with custom styling
export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      title="Page Error"
      onError={(error, errorInfo) => {
        console.error('Page Error:', error, errorInfo);
      }}
      onReset={() => {
        // Clear any cached data that might be causing the error
        sessionStorage.clear();
        window.location.reload();
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

// Component-level error boundary (less intrusive)
export function ComponentErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      title="Component Error"
      onError={(error) => {
        console.warn('Component Error:', error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
