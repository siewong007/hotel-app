import React from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useSystemHealth } from './hooks';
import { JobsTable } from './JobsTable';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <Card variant="outlined" sx={{ height: '100%' }}>
    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" component="div">
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </CardContent>
  </Card>
);

const SystemHealthPage: React.FC = () => {
  const health = useSystemHealth();

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            System Health
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Process metrics reset on restart — counters describe this process only.
          </Typography>
        </Box>
        <Tooltip title="Refresh now">
          <span>
            <IconButton
              onClick={() => health.refetch()}
              disabled={health.isFetching}
              aria-label="Refresh system health"
            >
              {health.isFetching ? <CircularProgress size={18} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {health.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          System health could not be loaded — the backend may be unreachable.
        </Alert>
      )}

      {health.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        health.data && (
          <>
            <Grid container spacing={1.5} sx={{ mb: 3 }}>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label="Database"
                  value={health.data.database === 'ok' ? 'Connected' : health.data.database}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat label="Uptime" value={formatUptime(health.data.uptime_seconds)} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label="Requests"
                  value={health.data.metrics.requests_total.toLocaleString()}
                  hint={`${health.data.metrics.requests_slow} slow`}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label="Errors"
                  value={`${health.data.metrics.responses_4xx} / ${health.data.metrics.responses_5xx}`}
                  hint="4xx / 5xx"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label="Denied"
                  value={`${health.data.metrics.auth_denied} / ${health.data.metrics.permission_denied}`}
                  hint="auth / permission"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label="Audit failures"
                  value={health.data.metrics.audit_write_failures}
                  hint={
                    health.data.metrics.audit_write_failures > 0
                      ? 'Audit trail has holes'
                      : 'None recorded'
                  }
                />
              </Grid>
            </Grid>

            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  Email queue
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {health.data.email_queue.queued} queued · {health.data.email_queue.sending}{' '}
                  sending · {health.data.email_queue.failed} failed ·{' '}
                  {health.data.email_queue.sent_24h} sent in the last 24h
                </Typography>
              </CardContent>
            </Card>

            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Background jobs
            </Typography>
            {!health.data.job_runs_enabled ? (
              <Alert severity="info">
                Job monitoring is not installed on this database yet — the <code>job_runs</code>{' '}
                table arrives with its migration patch. Loops still run; they are simply not
                recorded.
              </Alert>
            ) : health.data.jobs.length === 0 ? (
              <Alert severity="info">No job runs recorded yet.</Alert>
            ) : (
              <Card variant="outlined">
                <JobsTable jobs={health.data.jobs} />
              </Card>
            )}
          </>
        )
      )}
    </Box>
  );
};

export default SystemHealthPage;
