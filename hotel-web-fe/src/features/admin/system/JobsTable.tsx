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
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { TableScroll } from '../../../components/data-table/TableScroll';
import type { JobHealth } from './types';
import { formatRelativeTime, statusLabel, useTranslation } from '../../../i18n';
import { formatHotelDateTime } from '../../../utils/date';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const JobsTable: React.FC<{ jobs: JobHealth[] }> = ({ jobs }) => {
  const { t } = useTranslation('admin');
  const isPhone = useIsPhone();

  // Known scheduler jobs get a localized name; unknown names fall back to the
  // last key segment, i.e. the raw job identifier.
  const jobName = (name: string) => t(`system.jobs.names.${name}`);

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
              subtitle={t('system.jobs.cardMeta', {
                time: formatRelativeTime(job.last_run_at),
                runs: t('system.jobs.runsCount', { count: job.runs_24h }),
                failures: t('system.jobs.failuresCount', { count: job.failures_24h }),
              })}
              meta={
                job.last_error
                  ? t('system.jobs.lastError', { error: job.last_error })
                  : t('system.jobs.lastRunDuration', { duration: formatDuration(job.last_duration_ms) })
              }
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
                  label={statusLabel(t, 'job_run', job.last_status)}
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
          <TableCell>{t('system.jobs.colJob')}</TableCell>
          <TableCell>{t('system.jobs.colLastRun')}</TableCell>
          <TableCell>{t('common:field.status')}</TableCell>
          <TableCell align="right">{t('system.jobs.colDuration')}</TableCell>
          <TableCell align="right">{t('system.jobs.colRuns24')}</TableCell>
          <TableCell align="right">{t('system.jobs.colFailures24')}</TableCell>
          <TableCell>{t('system.jobs.colLastError')}</TableCell>
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
                label={statusLabel(t, 'job_run', job.last_status)}
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
