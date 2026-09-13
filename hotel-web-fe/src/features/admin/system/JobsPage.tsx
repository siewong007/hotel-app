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

const JobsPage: React.FC = () => {
  const health = useSystemHealth();
  const failures = useJobFailures(health.data?.job_runs_enabled ?? true);

  const isPending = health.isPending || failures.isPending;

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Jobs
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every scheduler iteration writes a heartbeat row — a quiet job still proves it is alive.
          </Typography>
        </Box>
        <Tooltip title="Refresh now">
          <span>
            <IconButton
              onClick={() => {
                health.refetch();
                failures.refetch();
              }}
              disabled={health.isFetching || failures.isFetching}
              aria-label="Refresh jobs"
            >
              {health.isFetching || failures.isFetching ? (
                <CircularProgress size={18} />
              ) : (
                <RefreshIcon />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {health.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Job status could not be loaded.
        </Alert>
      )}

      {isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : health.data && !health.data.job_runs_enabled ? (
        <Alert severity="info">
          Job monitoring is not installed on this database yet — the <code>job_runs</code> table
          arrives with its migration patch.
        </Alert>
      ) : (
        <>
          {health.data && health.data.jobs.length > 0 && (
            <Card variant="outlined" sx={{ mb: 3 }}>
              <JobsTable jobs={health.data.jobs} />
            </Card>
          )}

          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            Recent failures
          </Typography>
          {failures.data && failures.data.length === 0 ? (
            <Alert severity="success">No failed iterations on record.</Alert>
          ) : (
            <Card variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Job</TableCell>
                    <TableCell>Error</TableCell>
                    <TableCell align="right">Duration</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(failures.data ?? []).map((run) => (
                    <TableRow key={run.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {new Date(run.created_at).toLocaleString()}
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
            </Card>
          )}
        </>
      )}
    </Box>
  );
};

export default JobsPage;
