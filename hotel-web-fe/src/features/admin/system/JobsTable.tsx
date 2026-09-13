import React from 'react';
import {
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

import type { JobHealth } from './types';

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelative(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleString();
}

const JOB_LABELS: Record<string, string> = {
  night_audit: 'Night Audit',
  payment_receipts: 'Payment Receipts',
  unpaid_hold_release: 'Unpaid Hold Release',
  email_delivery_worker: 'Email Delivery Worker',
  email_campaigns: 'Email Campaigns',
  birthday_vouchers: 'Birthday Vouchers',
  pre_arrival_reminders: 'Pre-arrival Reminders',
};

export const JobsTable: React.FC<{ jobs: JobHealth[] }> = ({ jobs }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell>Job</TableCell>
        <TableCell>Last run</TableCell>
        <TableCell>Status</TableCell>
        <TableCell align="right">Duration</TableCell>
        <TableCell align="right">Runs (24h)</TableCell>
        <TableCell align="right">Failures (24h)</TableCell>
        <TableCell>Last error</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {jobs.map((job) => (
        <TableRow key={job.job_name} hover>
          <TableCell>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {JOB_LABELS[job.job_name] ?? job.job_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {job.job_name}
            </Typography>
          </TableCell>
          <TableCell>
            <Tooltip title={new Date(job.last_run_at).toLocaleString()}>
              <span>{formatRelative(job.last_run_at)}</span>
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
              label={job.last_status}
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
);
