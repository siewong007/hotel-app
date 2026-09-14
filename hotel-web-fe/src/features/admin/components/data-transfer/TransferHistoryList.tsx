import React from 'react';
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Download as DownloadIcon,
  History as HistoryIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../../components/data-table/MobileCardRow';
import type { TransferHistoryEntry } from './types';
import { describeHistoryAction, formatNum, formatWhen } from './utils';

interface TransferHistoryListProps {
  entries: TransferHistoryEntry[];
}

const statusChip = (status: TransferHistoryEntry['status']) => (
  <Chip
    label={status === 'success' ? 'Success' : status === 'partial' ? 'Partial' : 'Failed'}
    size="small"
    color={status === 'success' ? 'success' : status === 'partial' ? 'warning' : 'error'}
    sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
  />
);

const TransferHistoryList: React.FC<TransferHistoryListProps> = ({ entries }) => {
  const theme = useTheme();
  const isPhone = useIsPhone();

  const metaLine = (entry: TransferHistoryEntry) =>
    [
      entry.records === undefined ? null : `${formatNum(entry.records)} records`,
      entry.by,
      formatWhen(entry.at),
      entry.jobId ? `job ${entry.jobId.slice(0, 8)}` : null,
      entry.error,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>Transfer History</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12.5 }}>
          Every export and import performed on this device is logged with the user, time, and outcome.
        </Typography>
      </Box>
      {entries.length === 0 ? (
        <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
          <HistoryIcon sx={{ fontSize: 40, opacity: 0.4, mb: 1 }} />
          <Typography variant="body2">No transfers recorded yet.</Typography>
        </Box>
      ) : isPhone ? (
        <Box>
          {entries.map((entry) => (
            <Box
              key={entry.id}
              sx={{ borderBottom: `1px solid ${theme.palette.divider}`, '&:last-child': { borderBottom: 0 } }}
            >
              <MobileCardRow
                title={describeHistoryAction(entry)}
                subtitle={entry.categories}
                meta={metaLine(entry)}
                status={statusChip(entry.status)}
              />
            </Box>
          ))}
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Action</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Scope</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">
                  Records
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Performed by</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Date &amp; time</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
                      <Box
                        sx={{
                          width: 26,
                          height: 26,
                          borderRadius: 1.5,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                          color: 'primary.main',
                          '& svg': { fontSize: 16 },
                        }}
                      >
                        {entry.type === 'import' ? <UploadIcon /> : <DownloadIcon />}
                      </Box>
                      {describeHistoryAction(entry)}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>
                    <Typography variant="body2" sx={{ fontSize: 12.5 }}>
                      {entry.categories}
                    </Typography>
                    {entry.jobId && (
                      <Tooltip title={entry.jobId}>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', fontFamily: 'monospace' }}
                        >
                          job {entry.jobId.slice(0, 8)}…
                        </Typography>
                      </Tooltip>
                    )}
                    {entry.error && (
                      <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
                        {entry.error}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {entry.records === undefined ? '—' : formatNum(entry.records)}
                  </TableCell>
                  <TableCell>{entry.by}</TableCell>
                  <TableCell>{formatWhen(entry.at)}</TableCell>
                  <TableCell>{statusChip(entry.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
};

export default TransferHistoryList;
