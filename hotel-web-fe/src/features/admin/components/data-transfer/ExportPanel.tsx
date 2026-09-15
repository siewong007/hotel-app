import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
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
  VerifiedUser as VerifiedUserIcon,
} from '@mui/icons-material';
import { queryKeys } from '../../../../api/queryKeys';
import { useAuth } from '../../../../auth/AuthContext';
import { useTranslation } from '../../../../i18n';
import type { ExportPreview, ExportScope } from '../../../../types';
import { useExportDataMutation, useExportPreviewMutation } from '../../hooks/useDataTransferQueries';
import type { NotifyFn } from './types';
import StepUpDialog from './StepUpDialog';
import { exclusionReasonLabel, formatBytes, formatNum, shortEntityName } from './utils';

interface ExportPanelProps {
  notify: NotifyFn;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

interface TierDef {
  scope: ExportScope;
  /** Permission the card's actions require. */
  permission: 'data_transfer:export' | 'data_transfer:export_sensitive';
  /** Full/backup tiers re-authenticate before the download starts. */
  stepUp: boolean;
  /** Sensitive tiers get the confidential-data confirmation first. */
  sensitive: boolean;
}

const TIERS: TierDef[] = [
  { scope: 'standard', permission: 'data_transfer:export', stepUp: false, sensitive: false },
  { scope: 'full', permission: 'data_transfer:export_sensitive', stepUp: true, sensitive: true },
  { scope: 'backup', permission: 'data_transfer:export_sensitive', stepUp: true, sensitive: true },
];

const ExportPanel: React.FC<ExportPanelProps> = ({ notify }) => {
  const theme = useTheme();
  const { t } = useTranslation('dataTransfer');
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  // Per-scope preview so each card shows the manifest its tier would emit.
  const [previews, setPreviews] = useState<Partial<Record<ExportScope, ExportPreview>>>({});
  const [previewingScope, setPreviewingScope] = useState<ExportScope | null>(null);
  const [downloadingScope, setDownloadingScope] = useState<ExportScope | null>(null);
  // Sensitive tiers confirm before step-up; the pending scope survives both dialogs.
  const [confirmScope, setConfirmScope] = useState<ExportScope | null>(null);
  const [ackSensitive, setAckSensitive] = useState(false);
  const [stepUpScope, setStepUpScope] = useState<ExportScope | null>(null);
  // The panel's single error surface — mutations carry the skip-notification
  // header, so failures land here and nowhere else.
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useExportPreviewMutation();
  const exportMutation = useExportDataMutation();
  const busy = previewMutation.isPending || exportMutation.isPending;

  const handlePreview = async (scope: ExportScope) => {
    setError(null);
    setPreviewingScope(scope);
    try {
      const report = await previewMutation.mutateAsync(scope);
      setPreviews((prev) => ({ ...prev, [scope]: report }));
    } catch (err) {
      setError(errorMessage(err, 'Failed to preview export data.'));
    } finally {
      setPreviewingScope(null);
    }
  };

  const runExport = async (scope: ExportScope, stepUpToken?: string) => {
    setError(null);
    setDownloadingScope(scope);
    try {
      const download = await exportMutation.mutateAsync({ scope, stepUpToken });
      // The server audited the export — pull the fresh history row.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dataTransfer.history() });
      notify(`Backup downloaded — ${download.filename} (${formatBytes(download.bytes)}).`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to export data.'));
    } finally {
      setDownloadingScope(null);
    }
  };

  const handleDownload = (tier: TierDef) => {
    if (tier.sensitive) {
      setAckSensitive(false);
      setConfirmScope(tier.scope);
    } else if (tier.stepUp) {
      setStepUpScope(tier.scope);
    } else {
      void runExport(tier.scope);
    }
  };

  const confirmSensitive = () => {
    const scope = confirmScope;
    setConfirmScope(null);
    if (!scope) return;
    if (TIERS.find((tier) => tier.scope === scope)?.stepUp) {
      setStepUpScope(scope);
    } else {
      void runExport(scope);
    }
  };

  const cardSx = {
    borderRadius: 3,
    border: `1px solid ${theme.palette.divider}`,
    bgcolor: 'background.paper',
  } as const;

  const renderPreview = (scope: ExportScope) => {
    const preview = previews[scope];
    if (!preview) return null;
    const exclusionsByReason = new Map<string, string[]>();
    preview.exclusions.forEach((exclusion) => {
      const names = exclusionsByReason.get(exclusion.reason) ?? [];
      names.push(exclusion.name);
      exclusionsByReason.set(exclusion.reason, names);
    });
    return (
      <Box sx={{ borderTop: `1px solid ${theme.palette.divider}` }}>
        <Accordion
          elevation={0}
          disableGutters
          sx={{ '&::before': { display: 'none' }, borderBottom: `1px solid ${theme.palette.divider}` }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LockIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {t('export.neverIncluded', { count: preview.exclusions.length })}
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

        <TableContainer sx={{ maxHeight: 280 }}>
          <Table size="small" stickyHeader aria-label={t('export.previewScope', { scope })}>
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
      </Box>
    );
  };

  const renderTier = (tier: TierDef) => {
    const allowed = hasPermission(tier.permission);
    const preview = previews[tier.scope];
    return (
      <Paper key={tier.scope} elevation={0} sx={{ ...cardSx, opacity: allowed ? 1 : 0.72 }}>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 800, fontSize: 15 }}>{t(`export.${tier.scope}.title`)}</Typography>
            {tier.sensitive && (
              <Chip
                label={t(`export.${tier.scope}.restriction`)}
                size="small"
                color="warning"
                variant="outlined"
                sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
              />
            )}
            {tier.stepUp && (
              <Chip
                icon={<VerifiedUserIcon sx={{ fontSize: 14 }} />}
                label={t('export.stepUpRequired')}
                size="small"
                variant="outlined"
                sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
              />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12.5 }}>
            {t(`export.${tier.scope}.description`)}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t(`export.${tier.scope}.tagline`)}
          </Typography>
          {preview && (
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
              {formatNum(preview.total_records)} records · {formatNum(preview.entities.length)} entities
            </Typography>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.5, flexWrap: 'wrap' }}>
            {allowed ? (
              <>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={
                    previewingScope === tier.scope ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <InfoIcon />
                    )
                  }
                  onClick={() => void handlePreview(tier.scope)}
                  disabled={busy}
                  sx={{ fontWeight: 700 }}
                >
                  {t('export.preview')}
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={
                    downloadingScope === tier.scope ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <DownloadIcon />
                    )
                  }
                  onClick={() => handleDownload(tier)}
                  disabled={busy}
                  sx={{ fontWeight: 700 }}
                >
                  {t('export.download')}
                </Button>
              </>
            ) : (
              <Chip
                icon={<LockIcon sx={{ fontSize: 14 }} />}
                label={t('export.missingPermission', { permission: tier.permission })}
                size="small"
                variant="outlined"
                sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}
              />
            )}
          </Box>
        </Box>
        {renderPreview(tier.scope)}
      </Paper>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" icon={<ShieldIcon />} sx={{ borderRadius: 2 }}>
        {t('export.secretsExcluded')}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {TIERS.map(renderTier)}

      {/* ===== Sensitive-export confirmation ===== */}
      <Dialog
        open={confirmScope !== null}
        onClose={() => setConfirmScope(null)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
        aria-labelledby="sensitive-export-title"
      >
        <DialogContent sx={{ p: 3, textAlign: 'center' }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              mx: 'auto',
              mb: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(theme.palette.warning.main, 0.12),
              color: 'warning.main',
              '& svg': { fontSize: 30 },
            }}
          >
            <ShieldIcon />
          </Box>
          <Typography id="sensitive-export-title" sx={{ fontWeight: 800, fontSize: 18, mb: 1 }}>
            {t('export.sensitiveConfirmTitle')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('export.sensitiveConfirmBody')}
          </Typography>
          <Alert severity="warning" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('export.stepUpRequired')}</AlertTitle>
            {t('stepUp.description')}
          </Alert>
          <Box
            onClick={() => setAckSensitive((a) => !a)}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              p: 1.5,
              borderRadius: 2,
              bgcolor: theme.palette.action.hover,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Checkbox
              checked={ackSensitive}
              size="small"
              sx={{ p: 0 }}
              onChange={() => setAckSensitive((a) => !a)}
              onClick={(e) => e.stopPropagation()}
              slotProps={{ input: { 'aria-label': 'Acknowledge sensitive export warning' } }}
            />
            <Typography variant="body2">{t('export.sensitiveConfirmAck')}</Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button onClick={() => setConfirmScope(null)} color="inherit" fullWidth>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            fullWidth
            disabled={!ackSensitive}
            onClick={confirmSensitive}
            sx={{ fontWeight: 700 }}
          >
            {t('common:actions.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== Step-up re-authentication ===== */}
      <StepUpDialog
        open={stepUpScope !== null}
        onClose={() => setStepUpScope(null)}
        onVerified={(token) => {
          const scope = stepUpScope;
          setStepUpScope(null);
          if (scope) void runExport(scope, token);
        }}
      />
    </Box>
  );
};

export default ExportPanel;
