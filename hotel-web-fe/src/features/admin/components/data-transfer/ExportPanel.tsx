import React, { useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
  Info as InfoIcon,
  Lock as LockIcon,
  Shield as ShieldIcon,
} from '@mui/icons-material';
import type { ExportPreview } from '../../../../types';
import { useExportDataMutation, useExportPreviewMutation } from '../../hooks/useDataTransferQueries';
import type { NotifyFn, RecordHistoryFn } from './types';
import { exclusionReasonLabel, formatBytes, formatNum, shortEntityName } from './utils';

interface ExportPanelProps {
  notify: NotifyFn;
  onRecord: RecordHistoryFn;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const ExportPanel: React.FC<ExportPanelProps> = ({ notify, onRecord }) => {
  const theme = useTheme();
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  // The panel's single error surface — mutations carry the skip-notification
  // header, so failures land here and nowhere else.
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useExportPreviewMutation();
  const exportMutation = useExportDataMutation();
  const busy = previewMutation.isPending || exportMutation.isPending;

  const handlePreview = async () => {
    setError(null);
    try {
      setPreview(await previewMutation.mutateAsync());
    } catch (err) {
      setError(errorMessage(err, 'Failed to preview export data.'));
    }
  };

  const handleExport = async () => {
    setError(null);
    try {
      const download = await exportMutation.mutateAsync();
      onRecord({
        type: 'export',
        categories: 'Business data backup',
        records: preview?.total_records,
        status: 'success',
      });
      notify(`Backup downloaded — ${download.filename} (${formatBytes(download.bytes)}).`);
    } catch (err) {
      const message = errorMessage(err, 'Failed to export data.');
      onRecord({ type: 'export', categories: 'Business data backup', status: 'failed', error: message });
      setError(message);
    }
  };

  const exclusionsByReason = new Map<string, string[]>();
  preview?.exclusions.forEach((exclusion) => {
    const names = exclusionsByReason.get(exclusion.reason) ?? [];
    names.push(exclusion.name);
    exclusionsByReason.set(exclusion.reason, names);
  });

  const cardSx = {
    borderRadius: 3,
    border: `1px solid ${theme.palette.divider}`,
    bgcolor: 'background.paper',
  } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" icon={<ShieldIcon />} sx={{ borderRadius: 2 }}>
        <strong>A backup contains every transferable business-data table</strong> — configuration, guests, bookings,
        payments, loyalty, housekeeping — in one JSON file. Sign-in credentials, active sessions, passkeys and eKYC
        identity material are deliberately never included.
      </Alert>

      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {preview && (
        <Paper elevation={0} sx={cardSx}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
              flexWrap: 'wrap',
            }}
          >
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: 15 }}>Backup contents</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12.5 }}>
                {formatNum(preview.total_records)} records across {formatNum(preview.entities.length)} entities — live
                counts, exactly as the file will contain them.
              </Typography>
            </Box>
            <Chip
              label={`${formatNum(preview.total_records)} records`}
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          </Box>

          <Accordion
            elevation={0}
            disableGutters
            sx={{ '&::before': { display: 'none' }, borderBottom: `1px solid ${theme.palette.divider}` }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LockIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Never included — {formatNum(preview.exclusions.length)} protected tables
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 2, pt: 0 }}>
              {[...exclusionsByReason.entries()].map(([reason, names]) => (
                <Box key={reason} sx={{ mb: 1.25 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {exclusionReasonLabel(reason)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                    {names.join(', ')}
                  </Typography>
                </Box>
              ))}
            </AccordionDetails>
          </Accordion>

          <TableContainer sx={{ maxHeight: 360 }}>
            <Table size="small" stickyHeader aria-label="Entities included in the backup">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Entity</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">
                    Rows
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.tables.map((table) => (
                  <TableRow key={table.name} hover>
                    <TableCell>{shortEntityName(table.name)}</TableCell>
                    <TableCell align="right">{formatNum(table.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Paper
        elevation={0}
        sx={{ ...cardSx, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, p: 2 }}
      >
        <Button
          variant="outlined"
          startIcon={previewMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <InfoIcon />}
          onClick={handlePreview}
          disabled={busy}
          sx={{ fontWeight: 700 }}
        >
          Preview counts
        </Button>
        <Button
          variant="contained"
          startIcon={exportMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
          onClick={handleExport}
          disabled={busy}
          sx={{ fontWeight: 700 }}
        >
          Download backup
        </Button>
      </Paper>
    </Box>
  );
};

export default ExportPanel;
