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
import { formatNumber, useTranslation, type TranslationVars } from '../../../i18n';

type TFn = (key: string, vars?: TranslationVars) => string;

function formatUptime(t: TFn, seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return t('system.health.uptimeDays', { days, hours });
  if (hours > 0) return t('system.health.uptimeHours', { hours, minutes });
  return t('system.health.uptimeMinutes', { minutes });
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
            {t('system.health.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('system.health.subtitle')}
          </Typography>
        </Box>
        <Tooltip title={t('system.refreshNow')}>
          <span>
            <IconButton
              onClick={() => health.refetch()}
              disabled={health.isFetching}
              aria-label={t('system.health.refreshAria')}
            >
              {health.isFetching ? <CircularProgress size={18} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {health.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('system.health.loadError')}
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
                  label={t('system.health.database')}
                  value={health.data.database === 'ok' ? t('system.health.connected') : health.data.database}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat label={t('system.health.uptime')} value={formatUptime(t, health.data.uptime_seconds)} />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('system.health.requests')}
                  value={formatNumber(health.data.metrics.requests_total)}
                  hint={t('system.health.requestsSlow', { count: health.data.metrics.requests_slow })}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('system.health.errors')}
                  value={`${formatNumber(health.data.metrics.responses_4xx)} / ${formatNumber(health.data.metrics.responses_5xx)}`}
                  hint={t('system.health.errorsHint')}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('system.health.denied')}
                  value={`${formatNumber(health.data.metrics.auth_denied)} / ${formatNumber(health.data.metrics.permission_denied)}`}
                  hint={t('system.health.deniedHint')}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 4, md: 2 }}>
                <Stat
                  label={t('system.health.auditFailures')}
                  value={formatNumber(health.data.metrics.audit_write_failures)}
                  hint={
                    health.data.metrics.audit_write_failures > 0
                      ? t('system.health.auditHoles')
                      : t('system.health.noneRecorded')
                  }
                />
              </Grid>
            </Grid>

            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  {t('system.health.emailQueue')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('system.health.emailQueueSummary', {
                    queued: formatNumber(health.data.email_queue.queued),
                    sending: formatNumber(health.data.email_queue.sending),
                    failed: formatNumber(health.data.email_queue.failed),
                    sent: formatNumber(health.data.email_queue.sent_24h),
                  })}
                </Typography>
              </CardContent>
            </Card>

            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              {t('system.health.backgroundJobs')}
            </Typography>
            {!health.data.job_runs_enabled ? (
              <Alert severity="info">
                {t('system.jobs.notInstalledDetail', { table: 'job_runs' })}
              </Alert>
            ) : health.data.jobs.length === 0 ? (
              <Alert severity="info">{t('system.jobs.noRuns')}</Alert>
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
