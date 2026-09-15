import React from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useJobFailures, useSystemHealth } from './hooks';
import { JobsTable } from './JobsTable';
import PageHeader from '../../../components/common/PageHeader';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { TableScroll } from '../../../components/data-table/TableScroll';
import { useTranslation } from '../../../i18n';
import { formatHotelDateTime } from '../../../utils/date';

const JobsPage: React.FC = () => {
  const { t } = useTranslation('admin');
  const isPhone = useIsPhone();
  const health = useSystemHealth();
  const failures = useJobFailures(health.data?.job_runs_enabled ?? true);

  const isPending = health.isPending || failures.isPending;

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title={t('system.jobs.title')}
        subtitle={t('system.jobs.subtitle')}
        sx={{ mb: 2 }}
        actions={
          <Tooltip title={t('system.refreshNow')}>
            <span>
              <IconButton
                onClick={() => {
                  health.refetch();
                  failures.refetch();
                }}
                disabled={health.isFetching || failures.isFetching}
                aria-label={t('system.jobs.refreshAria')}
              >
                {health.isFetching || failures.isFetching ? (
                  <CircularProgress size={18} />
                ) : (
                  <RefreshIcon />
                )}
              </IconButton>
            </span>
          </Tooltip>
        }
      />

      {health.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('system.jobs.loadError')}
        </Alert>
      )}

      {isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : health.data && !health.data.job_runs_enabled ? (
        <Alert severity="info">
          {t('system.jobs.notInstalled', { table: 'job_runs' })}
        </Alert>
      ) : (
        <>
          {health.data && health.data.jobs.length > 0 && (
            <Card variant="outlined" sx={{ mb: 3 }}>
              <JobsTable jobs={health.data.jobs} />
            </Card>
          )}

          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {t('system.jobs.recentFailures')}
          </Typography>
          {failures.data && failures.data.length === 0 ? (
            <Alert severity="success">{t('system.jobs.noFailures')}</Alert>
          ) : isPhone ? (
            <Card variant="outlined">
              {(failures.data ?? []).map((run) => (
                <Box
                  key={run.id}
                  sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                >
                  <MobileCardRow
                    title={run.job_name}
                    subtitle={formatHotelDateTime(run.created_at)}
                    meta={run.error ? `${run.error} · ${run.duration_ms !== null ? `${run.duration_ms}ms` : '—'}` : (run.duration_ms !== null ? `${run.duration_ms}ms` : '—')}
                  />
                </Box>
              ))}
            </Card>
          ) : (
            <Card variant="outlined">
              <TableScroll>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('system.jobs.colWhen')}</TableCell>
                      <TableCell>{t('system.jobs.colJob')}</TableCell>
                      <TableCell>{t('system.jobs.colError')}</TableCell>
                      <TableCell align="right">{t('system.jobs.colDuration')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(failures.data ?? []).map((run) => (
                      <TableRow key={run.id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatHotelDateTime(run.created_at)}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={run.job_name} variant="outlined" />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color="error.main">
                            {run.error ?? '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {run.duration_ms !== null ? `${run.duration_ms}ms` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableScroll>
            </Card>
          )}
        </>
      )}
    </Box>
  );
};

export default JobsPage;
