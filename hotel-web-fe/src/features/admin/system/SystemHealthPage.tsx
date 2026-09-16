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
import { LogoLoader } from '../../../components';
import { useTranslation } from '../../../i18n';
import { formatNumber } from '../../../i18n/format';

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
  const { t } = useTranslation('admin');
  const health = useSystemHealth();

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t('systemHealth.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('systemHealth.subtitle')}
          </Typography>
        </Box>
        <Tooltip title={t('common:actions.refresh')}>
          <span>
            <IconButton
              onClick={() => health.refetch()}
              disabled={health.isFetching}
              aria-label={t('systemHealth.refresh')}
            >
              {health.isFetching ? <CircularProgress size={18} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {health.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('systemHealth.loadError')}
        </Alert>
      )}

      {health.isPending ? (
        <LogoLoader variant="page" />
      ) : (
        health.data && (
          <>
            <Grid container spacing={1.5} sx={{ mb: 3 }}>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('systemHealth.database')}
                  value={health.data.database === 'ok' ? t('systemHealth.connected') : health.data.database}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat label={t('systemHealth.uptime')} value={formatUptime(health.data.uptime_seconds)} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('systemHealth.requests')}
                  value={formatNumber(health.data.metrics.requests_total)}
                  hint={t('systemHealth.slowHint', { count: formatNumber(health.data.metrics.requests_slow) })}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('systemHealth.errors')}
                  value={`${health.data.metrics.responses_4xx} / ${health.data.metrics.responses_5xx}`}
                  hint="4xx / 5xx"
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('systemHealth.denied')}
                  value={`${health.data.metrics.auth_denied} / ${health.data.metrics.permission_denied}`}
                  hint={t('systemHealth.deniedHint')}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('systemHealth.auditFailures')}
                  value={health.data.metrics.audit_write_failures}
                  hint={
                    health.data.metrics.audit_write_failures > 0
                      ? t('systemHealth.auditHoles')
                      : t('systemHealth.noneRecorded')
                  }
                />
              </Grid>
            </Grid>

            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  {t('systemHealth.emailQueue')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('systemHealth.emailQueueLine', {
                    queued: formatNumber(health.data.email_queue.queued),
                    sending: formatNumber(health.data.email_queue.sending),
                    failed: formatNumber(health.data.email_queue.failed),
                    sent: formatNumber(health.data.email_queue.sent_24h),
                  })}
                </Typography>
              </CardContent>
            </Card>

            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              {t('systemHealth.backgroundJobs')}
            </Typography>
            {!health.data.job_runs_enabled ? (
              <Alert severity="info">
                {t('systemHealth.jobsNotInstalledStart')}
                <code>job_runs</code>
                {t('systemHealth.jobsNotInstalledEnd')}
              </Alert>
            ) : health.data.jobs.length === 0 ? (
              <Alert severity="info">{t('systemHealth.noJobRuns')}</Alert>
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
