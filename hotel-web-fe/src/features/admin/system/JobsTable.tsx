import React from 'react';
import {
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';

import { useIsPhone } from '../../../hooks/useIsPhone';
import { useTranslation, statusLabel } from '../../../i18n';
import { formatRelativeTime } from '../../../i18n/format';
import { formatHotelDateTime } from '../../../utils/date';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { TableScroll } from '../../../components/data-table/TableScroll';
import type { JobHealth } from './types';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const JOB_LABEL_KEYS: Record<string, string> = {
  night_audit: 'admin:jobs.names.night_audit',
  payment_receipts: 'admin:jobs.names.payment_receipts',
  unpaid_hold_release: 'admin:jobs.names.unpaid_hold_release',
  email_delivery_worker: 'admin:jobs.names.email_delivery_worker',
  email_campaigns: 'admin:jobs.names.email_campaigns',
  birthday_vouchers: 'admin:jobs.names.birthday_vouchers',
  pre_arrival_reminders: 'admin:jobs.names.pre_arrival_reminders',
};

export const JobsTable: React.FC<{ jobs: JobHealth[] }> = ({ jobs }) => {
  const isPhone = useIsPhone();
  const { t, tOr } = useTranslation('admin');
  const jobName = (name: string) =>
    JOB_LABEL_KEYS[name] ? t(JOB_LABEL_KEYS[name]) : name;

  if (isPhone) {
    return (
      <Box>
        {jobs.map((job) => (
          <Box
            key={job.job_name}
            sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <MobileCardRow
              title={jobName(job.job_name)}
              subtitle={t('jobs.cardSubtitle', {
                at: formatRelativeTime(job.last_run_at),
                runs: job.runs_24h,
                failures: job.failures_24h,
              })}
              meta={job.last_error ? t('jobs.lastError', { error: job.last_error }) : t('jobs.lastRunDuration', { duration: formatDuration(job.last_duration_ms) })}
              status={
                <Chip
                  size="small"
                  icon={
                    job.last_status === 'ok' ? (
                      <CheckCircleOutlineIcon />
                    ) : (
                      <ErrorOutlineIcon />
                    )
                  }
                  label={statusLabel(t, 'job', job.last_status)}
                  color={job.last_status === 'ok' ? 'success' : 'error'}
                  variant="outlined"
                />
              }
            />
          </Box>
        ))}
      </Box>
    );
  }

  return (
  <TableScroll>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{t('jobs.col.job')}</TableCell>
          <TableCell>{t('jobs.col.lastRun')}</TableCell>
          <TableCell>{t('common:field.status')}</TableCell>
          <TableCell align="right">{t('jobs.col.duration')}</TableCell>
          <TableCell align="right">{t('jobs.col.runs24h')}</TableCell>
          <TableCell align="right">{t('jobs.col.failures24h')}</TableCell>
          <TableCell>{t('jobs.col.lastError')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.job_name} hover>
            <TableCell>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {jobName(job.job_name)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {job.job_name}
              </Typography>
            </TableCell>
            <TableCell>
              <Tooltip title={formatHotelDateTime(job.last_run_at)}>
                <span>{formatRelativeTime(job.last_run_at)}</span>
              </Tooltip>
            </TableCell>
            <TableCell>
              <Chip
                size="small"
                icon={
                  job.last_status === 'ok' ? (
                    <CheckCircleOutlineIcon />
                  ) : (
                    <ErrorOutlineIcon />
                  )
                }
                label={statusLabel(t, 'job', job.last_status)}
                color={job.last_status === 'ok' ? 'success' : 'error'}
                variant="outlined"
              />
            </TableCell>
            <TableCell align="right">{formatDuration(job.last_duration_ms)}</TableCell>
            <TableCell align="right">{job.runs_24h}</TableCell>
            <TableCell align="right">
              {job.failures_24h > 0 ? (
                <Typography component="span" color="error.main" sx={{ fontWeight: 700 }}>
                  {job.failures_24h}
                </Typography>
              ) : (
                0
              )}
            </TableCell>
            <TableCell sx={{ maxWidth: 280 }}>
              {job.last_error ? (
                <Tooltip title={job.last_error}>
                  <Typography
                    variant="caption"
                    color="error.main"
                    sx={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {job.last_error}
                  </Typography>
                </Tooltip>
              ) : (
                '—'
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </TableScroll>
  );
};
