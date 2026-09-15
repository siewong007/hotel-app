import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
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
  FormControlLabel,
  LinearProgress,
  Paper,
  Radio,
  RadioGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CheckCircle as SuccessIcon,
  Close as CloseIcon,
  CloudUpload as CloudUploadIcon,
  Error as ErrorIcon,
  InsertDriveFile as FileIcon,
  Lock as LockIcon,
  Upload as UploadIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import type { ImportPreview, UploadResponse } from '../../../../types';
import { invalidateImportedData } from '../../../../api/queryInvalidation';
import { queryKeys } from '../../../../api/queryKeys';
import {
  useDeleteUploadMutation,
  useExecuteImportMutation,
  useImportJob,
  useImportPreviewMutation,
  useUploadBackupMutation,
} from '../../hooks/useDataTransferQueries';
import { useAuth } from '../../../../auth/AuthContext';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { useTranslation } from '../../../../i18n';
import { MobileCardRow } from '../../../../components/data-table/MobileCardRow';
import { IMPORT_JOB_POLL_MS, MAX_BACKUP_FILE_BYTES } from './constants';
import StepUpDialog from './StepUpDialog';
import type { NotifyFn } from './types';
import { formatBytes, formatNum, formatWhen, shortEntityName } from './utils';
import type { BackupImportMode, ConflictPolicy } from '../../../../types';

interface ImportWizardProps {
  notify: NotifyFn;
  /** Switch to the History tab once a job reaches a terminal state. */
  onFinished: () => void;
  /** Test seam for the job poll interval; production uses IMPORT_JOB_POLL_MS. */
  pollIntervalMs?: number;
}

type WizardStep = 'select' | 'processing' | 'review' | 'running' | 'done';

/** One row of the entity table — `null` cells render as an em dash (v1
 * backups carry no new/existing/skipped diff). */
interface EntityTableRow {
  name: string;
  cells: Array<number | null>;
}

const CONFLICT_KEYS: Record<ConflictPolicy, string> = {
  skip: 'import.conflicts.skip',
  update: 'import.conflicts.update',
  fail: 'import.conflicts.fail',
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const nullableCount = (value: number | null): string => (value === null ? '—' : formatNum(value));

const ImportWizard: React.FC<ImportWizardProps> = ({ notify, onFinished, pollIntervalMs }) => {
  const theme = useTheme();
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { t } = useTranslation('dataTransfer');

  // The backend re-checks all of these at execute time — the client gates are
  // for honest UI, not security.
  const canOverride = hasPermission('data_transfer:override');
  const canRestore = hasPermission('data_transfer:restore');

  const [step, setStep] = useState<WizardStep>('select');
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<BackupImportMode>('merge');
  const [onConflict, setOnConflict] = useState<ConflictPolicy>('skip');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  // The wizard's single error surface — services send the skip-notification
  // header, so nothing else (global toast) reports these failures.
  const [error, setError] = useState<string | null>(null);

  const uploadMutation = useUploadBackupMutation();
  const previewMutation = useImportPreviewMutation();
  const executeMutation = useExecuteImportMutation();
  const deleteUploadMutation = useDeleteUploadMutation();
  const jobQuery = useImportJob(jobId, pollIntervalMs ?? IMPORT_JOB_POLL_MS);
  const job = jobQuery.data;
  const recordedJobRef = useRef<string | null>(null);

  // Surface terminal job states exactly once per job — the server writes the
  // audit row itself, so the history query just needs invalidating.
  useEffect(() => {
    if (!jobId || !job || job.status === 'running' || recordedJobRef.current === jobId) return;
    recordedJobRef.current = jobId;
    void queryClient.invalidateQueries({ queryKey: queryKeys.dataTransfer.history() });

    if (job.status === 'succeeded') {
      const inserted = job.result?.inserted ?? 0;
      const updated = job.result?.updated ?? 0;
      const skipped = job.result?.skipped ?? 0;
      invalidateImportedData(queryClient);
      notify(
        skipped > 0
          ? t('import.jobFinishedSkipped', { count: skipped })
          : t('import.jobFinished', { count: inserted + updated }),
        skipped > 0 ? 'warning' : 'success',
      );
    }
    setStep('done');
  }, [job, jobId, notify, queryClient, t]);

  const reset = () => {
    setFile(null);
    setUpload(null);
    setPreview(null);
    setJobId(null);
    setMode('merge');
    setOnConflict('skip');
    setAck(false);
    setConfirmOpen(false);
    setStepUpOpen(false);
    setError(null);
    setStep('select');
    recordedJobRef.current = null;
  };

  const discardAndReset = () => {
    // A staged upload the job never consumed would otherwise linger until the
    // server's 24 h sweep — discard it best-effort (a job-held file 409s, which
    // is fine to ignore).
    if (upload && !jobId) {
      void deleteUploadMutation.mutateAsync(upload.uploadId).catch(() => undefined);
    }
    reset();
  };

  const processUpload = async (picked: File) => {
    setFile(picked);
    setStep('processing');
    try {
      const staged = await uploadMutation.mutateAsync(picked);
      setUpload(staged);
      try {
        const report = await previewMutation.mutateAsync(staged.uploadId);
        setPreview(report);
        setStep('review');
      } catch (previewError) {
        // Without a preview the upload is unusable — free the staged file.
        void deleteUploadMutation.mutateAsync(staged.uploadId).catch(() => undefined);
        setError(errorMessage(previewError, t('import.errors.preview')));
        setStep('select');
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError, t('import.errors.upload')));
      setStep('select');
    }
  };

  const acceptFile = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    if (picked.size > MAX_BACKUP_FILE_BYTES) {
      setError(
        t('import.errors.tooLarge', {
          name: picked.name,
          size: formatBytes(picked.size),
          limit: formatBytes(MAX_BACKUP_FILE_BYTES),
        }),
      );
      return;
    }
    void processUpload(picked);
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    acceptFile(picked);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const openConfirm = () => {
    setAck(false);
    setConfirmOpen(true);
  };

  const execute = async (stepUpToken?: string) => {
    if (!upload || !ack) return;
    try {
      const response = await executeMutation.mutateAsync({
        uploadId: upload.uploadId,
        mode,
        onConflict: mode === 'merge' ? onConflict : undefined,
        stepUpToken,
      });
      setJobId(response.jobId);
      setConfirmOpen(false);
      setStep('running');
    } catch (err) {
      setConfirmOpen(false);
      setError(errorMessage(err, t('import.errors.start')));
    }
  };

  // Restore leaves the confirm dialog via the step-up dialog first — the
  // server demands a fresh `X-Step-Up` token for `mode: "restore"`.
  const confirmAndContinue = () => {
    if (mode === 'restore') {
      setStepUpOpen(true);
    } else {
      void execute();
    }
  };

  const blockedByValidation = (preview?.validationErrors.length ?? 0) > 0;
  // Permissions the file's contents demand beyond `data_transfer:import`
  // (today: `import_sensitive` on a sensitive upload), filtered to the ones
  // this account actually lacks.
  const missingPermissions = (preview?.requiresPermissions ?? []).filter(
    (permission) => !hasPermission(permission),
  );
  const busy = uploadMutation.isPending || previewMutation.isPending || executeMutation.isPending;

  const cardSx = {
    borderRadius: 3,
    border: `1px solid ${theme.palette.divider}`,
    bgcolor: 'background.paper',
  } as const;

  const renderEntityTable = (rows: EntityTableRow[], headers: string[], ariaLabel: string) => {
    if (isPhone) {
      return (
        <Box>
          {rows.map((row) => (
            <Box
              key={row.name}
              sx={{ borderBottom: `1px solid ${theme.palette.divider}`, '&:last-child': { borderBottom: 0 } }}
            >
              <MobileCardRow
                title={shortEntityName(row.name)}
                meta={row.cells.map((cell, i) => `${headers[i]}: ${nullableCount(cell)}`).join(' · ')}
              />
            </Box>
          ))}
        </Box>
      );
    }
    return (
      <TableContainer sx={{ maxHeight: 360 }}>
        <Table size="small" stickyHeader aria-label={ariaLabel}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>{t('import.colEntity')}</TableCell>
              {headers.map((header) => (
                <TableCell key={header} sx={{ fontWeight: 700 }} align="right">
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name} hover>
                <TableCell>{shortEntityName(row.name)}</TableCell>
                {row.cells.map((cell, i) => (
                  <TableCell key={headers[i]} align="right">
                    {nullableCount(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  // -- select ---------------------------------------------------------------
  const renderSelect = () => (
    <Paper
      elevation={0}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      sx={{
        ...cardSx,
        p: 6,
        textAlign: 'center',
        borderStyle: 'dashed',
        borderWidth: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <Box
        sx={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.1),
          color: 'primary.main',
          '& svg': { fontSize: 32 },
        }}
      >
        <CloudUploadIcon />
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: 18 }}>{t('import.selectTitle')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 480 }}>
          {t('import.selectDrop1')} <strong>.json</strong> {t('import.selectDrop2', { size: formatBytes(MAX_BACKUP_FILE_BYTES) })}
        </Typography>
      </Box>
      <Button variant="contained" component="label" startIcon={<UploadIcon />} sx={{ fontWeight: 700 }}>
        {t('import.selectFile')}
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleFileInput}
          aria-label={t('import.chooseFileAria')}
        />
      </Button>
    </Paper>
  );

  // -- processing -----------------------------------------------------------
  const renderProcessing = () => (
    <Paper elevation={0} sx={{ ...cardSx, p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            color: 'primary.main',
          }}
        >
          <FileIcon />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14 }} noWrap>
            {file?.name}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {file ? formatBytes(file.size) : ''}
          </Typography>
        </Box>
      </Box>
      {/* No byte-level upload progress: fetch/ky cannot report it, so the bar
          stays indeterminate while the file streams and is analyzed. */}
      <LinearProgress aria-label={t('import.processingAria')} />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {previewMutation.isPending ? t('import.analyzing') : t('import.uploading')}
      </Typography>
    </Paper>
  );

  // -- review ---------------------------------------------------------------
  const renderReview = () => {
    if (!preview) return null;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper
          elevation={0}
          sx={{
            ...cardSx,
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                color: 'primary.main',
              }}
            >
              <FileIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ fontWeight: 700, fontSize: 14 }} noWrap>
                  {file?.name}
                </Typography>
                <Chip
                  label={preview.format.toUpperCase()}
                  size="small"
                  color={preview.format === 'v1' ? 'primary' : 'default'}
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                />
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {[
                  preview.version !== null ? t('import.metaFormat', { version: preview.version }) : null,
                  preview.exportedAt ? t('import.metaExported', { date: formatWhen(Date.parse(preview.exportedAt)) }) : null,
                  preview.sourceEnvironment ? t('import.metaFrom', { env: preview.sourceEnvironment }) : null,
                  preview.applicationVersion ? t('import.metaApp', { version: preview.applicationVersion }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || t('import.metaUnavailable')}
              </Typography>
            </Box>
          </Box>
          <Button
            color="inherit"
            startIcon={<CloseIcon />}
            onClick={discardAndReset}
            sx={{ color: 'text.secondary', fontWeight: 600 }}
          >
            {t('import.removeFile')}
          </Button>
        </Paper>

        {preview.validationErrors.length > 0 && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('import.cannotImport')}</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {preview.validationErrors.map((validationError) => (
                <li key={validationError}>{validationError}</li>
              ))}
            </Box>
          </Alert>
        )}

        {preview.sensitive && (
          <Alert severity="warning" icon={<LockIcon />} sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('import.sensitiveTitle')}</AlertTitle>
            {t('import.sensitiveWarning')}
          </Alert>
        )}

        {missingPermissions.length > 0 && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('import.missingTitle')}</AlertTitle>
            {t('import.missingPermissions', { permissions: missingPermissions.join(', ') })}
          </Alert>
        )}

        {preview.warnings.map((warning) => (
          <Alert key={warning} severity="warning" icon={<WarningIcon />} sx={{ borderRadius: 2 }}>
            {warning}
          </Alert>
        ))}

        {preview.relationshipProblems.length > 0 && (
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>
              {t('import.rowsWillBeSkipped', { count: preview.relationshipProblems.reduce((sum, p) => sum + p.rows, 0) })}
            </AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {preview.relationshipProblems.map((problem) => (
                <li key={`${problem.entity}-${problem.reason}`}>
                  <strong>{shortEntityName(problem.entity)}</strong>: {t('import.problemRows', { count: problem.rows, reason: problem.reason })}
                </li>
              ))}
            </Box>
          </Alert>
        )}

        {preview.unsupportedEntities.length > 0 && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('import.unrecognizedTitle')}</AlertTitle>
            {t('import.unrecognizedBody', { entities: preview.unsupportedEntities.map(shortEntityName).join(', ') })}
          </Alert>
        )}

        <Paper elevation={0} sx={cardSx}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Typography sx={{ fontWeight: 800, fontSize: 15 }}>
              {t('import.previewSummary', { rows: formatNum(preview.totalRows), entities: formatNum(preview.entities.length) })}
            </Typography>
          </Box>
          {renderEntityTable(
            preview.entities.map((entity) => ({
              name: entity.name,
              cells: [entity.rows, entity.new, entity.existing, entity.skipped],
            })),
            [t('import.cols.rows'), t('import.cols.new'), t('import.cols.existing'), t('import.cols.skipped')],
            t('import.entitiesAria'),
          )}
        </Paper>

        <Paper elevation={0} sx={{ ...cardSx, p: 2 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1.5 }}>{t('import.modeTitle')}</Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_, value) => value && setMode(value)}
            aria-label={t('import.modeAria')}
            sx={{ mb: mode === 'merge' ? 2 : 0 }}
          >
            <ToggleButton value="merge" sx={{ textTransform: 'none', fontWeight: 700 }}>
              {t('import.modeMerge')}
            </ToggleButton>
            <ToggleButton
              value="restore"
              disabled={!canRestore}
              sx={{ textTransform: 'none', fontWeight: 700 }}
            >
              {t('import.modeRestore')}
            </ToggleButton>
          </ToggleButtonGroup>
          {!canRestore && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              {t('import.restoreRequiresPermission')}
            </Typography>
          )}

          {mode === 'merge' && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                {t('import.conflictTitle')}
              </Typography>
              <RadioGroup
                value={onConflict}
                onChange={(e) => setOnConflict(e.target.value as ConflictPolicy)}
                aria-label={t('import.conflictAria')}
              >
                {(Object.keys(CONFLICT_KEYS) as ConflictPolicy[]).map((policy) => (
                  <FormControlLabel
                    key={policy}
                    value={policy}
                    control={<Radio size="small" />}
                    label={
                      policy === 'update' && !canOverride
                        ? `${t(CONFLICT_KEYS[policy])} (${t('import.updateRequiresPermission')})`
                        : t(CONFLICT_KEYS[policy])
                    }
                    disabled={policy === 'update' && !canOverride}
                  />
                ))}
              </RadioGroup>
            </Box>
          )}

          {mode === 'restore' && (
            <Alert severity="error" sx={{ borderRadius: 2, mt: 1.5 }}>
              <AlertTitle sx={{ fontWeight: 700 }}>{t('import.restoreWarningTitle')}</AlertTitle>
              {t('import.restoreWarningBody')}
            </Alert>
          )}
        </Paper>

        <Paper
          elevation={0}
          sx={{ ...cardSx, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, p: 2 }}
        >
          <Button color="inherit" onClick={discardAndReset} sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {t('import.chooseDifferent')}
          </Button>
          <Button
            variant="contained"
            onClick={openConfirm}
            disabled={blockedByValidation || missingPermissions.length > 0 || busy}
            sx={{ fontWeight: 700 }}
          >
            {t('import.reviewImport')}
          </Button>
        </Paper>
      </Box>
    );
  };

  // -- running --------------------------------------------------------------
  const renderRunning = () => {
    const progress = job?.progress;
    const total = progress?.totalRows ?? preview?.totalRows ?? 0;
    const applied = progress?.rowsApplied ?? 0;
    return (
      <Paper elevation={0} sx={{ ...cardSx, p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={22} />
          <Typography sx={{ fontWeight: 800, fontSize: 15 }}>{t('import.runningTitle')}</Typography>
        </Box>
        <LinearProgress
          variant={total > 0 ? 'determinate' : 'indeterminate'}
          value={total > 0 ? Math.min(100, (applied / total) * 100) : undefined}
          aria-label={t('import.progressAria')}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {progress?.entity
            ? t('import.applyingEntity', { entity: shortEntityName(progress.entity), applied: formatNum(applied), total: formatNum(total) })
            : t('import.rowsApplied', { applied: formatNum(applied), total: formatNum(total) })}
        </Typography>
        {jobQuery.isError && (
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            {t('import.progressRefreshFailed')}
          </Alert>
        )}
      </Paper>
    );
  };

  // -- done -------------------------------------------------------------------
  const renderDone = () => {
    if (job?.status === 'failed') {
      return (
        <Paper elevation={0} sx={{ ...cardSx, p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="error" icon={<ErrorIcon />} sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('import.failedTitle')}</AlertTitle>
            {job.error ?? t('import.failedGeneric')} {t('import.failedTxn')}
          </Alert>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
            <Button variant="outlined" onClick={onFinished} sx={{ fontWeight: 700 }}>
              {t('import.viewHistory')}
            </Button>
            <Button variant="contained" onClick={reset} sx={{ fontWeight: 700 }}>
              {t('import.startOver')}
            </Button>
          </Box>
        </Paper>
      );
    }

    const result = job?.result;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Paper elevation={0} sx={{ ...cardSx, p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SuccessIcon color="success" />
            <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{t('import.completeTitle')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip label={t('import.insertedCount', { count: result?.inserted ?? 0 })} color="success" variant="outlined" sx={{ fontWeight: 700 }} />
            <Chip label={t('import.updatedCount', { count: result?.updated ?? 0 })} variant="outlined" sx={{ fontWeight: 700 }} />
            <Chip
              label={t('import.skippedCount', { count: result?.skipped ?? 0 })}
              color={result?.skipped ? 'warning' : 'default'}
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          </Box>
        </Paper>

        {result && result.report.relationshipProblems.length > 0 && (
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>{t('import.skippedRefsTitle')}</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {result.report.relationshipProblems.map((problem) => (
                <li key={`${problem.entity}-${problem.reason}`}>
                  <strong>{shortEntityName(problem.entity)}</strong>: {t('import.problemRows', { count: problem.rows, reason: problem.reason })}
                </li>
              ))}
            </Box>
          </Alert>
        )}

        {result && result.report.unsupportedEntities.length > 0 && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            {t('import.notApplied', { entities: result.report.unsupportedEntities.map(shortEntityName).join(', ') })}
          </Alert>
        )}

        {result && result.report.entities.length > 0 && (
          <Paper elevation={0} sx={cardSx}>
            {renderEntityTable(
              result.report.entities.map((outcome) => ({
                name: outcome.entity,
                cells: [outcome.inserted, outcome.updated, outcome.skipped],
              })),
              [t('import.cols.inserted'), t('import.cols.updated'), t('import.cols.skipped')],
              t('import.resultsAria'),
            )}
          </Paper>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
          <Button variant="outlined" onClick={onFinished} sx={{ fontWeight: 700 }}>
            {t('import.viewHistory')}
          </Button>
          <Button variant="contained" onClick={reset} sx={{ fontWeight: 700 }}>
            {t('import.importAnother')}
          </Button>
        </Box>
      </Box>
    );
  };

  // =========================================================================

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }} onClose={() => setError(null)} role="alert">
          {error}
        </Alert>
      )}

      {step === 'select' && renderSelect()}
      {step === 'processing' && renderProcessing()}
      {step === 'review' && renderReview()}
      {step === 'running' && renderRunning()}
      {step === 'done' && renderDone()}

      {/* ===== Confirm dialog ===== */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
        aria-labelledby="import-confirm-title"
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
              bgcolor: alpha(mode === 'restore' ? theme.palette.error.main : theme.palette.warning.main, 0.12),
              color: mode === 'restore' ? 'error.main' : 'warning.main',
              '& svg': { fontSize: 30 },
            }}
          >
            {mode === 'restore' ? <ErrorIcon /> : <WarningIcon />}
          </Box>
          <Typography id="import-confirm-title" sx={{ fontWeight: 800, fontSize: 18, mb: 1 }}>
            {mode === 'restore' ? t('import.confirmRestore') : t('import.confirmImport')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {t('import.confirmAbout', { mode: t(`import.modes.${mode}`) })}{' '}
            <strong>{t('import.confirmRows', { count: preview?.totalRows ?? 0 })}</strong> {t('import.confirmAcross')}{' '}
            <strong>{t('import.confirmEntities', { count: preview?.entities.length ?? 0 })}</strong>. {t('import.confirmLogged')}
          </Typography>

          {mode === 'restore' ? (
            <Alert severity="error" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
              <AlertTitle sx={{ fontWeight: 700 }}>{t('import.confirmDeleteTitle')}</AlertTitle>
              {t('import.confirmDeleteBody1')} <em>{t('import.confirmDeleteEm')}</em> {t('import.confirmDeleteBody2')}
            </Alert>
          ) : (
            <Alert severity="info" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
              {t('import.confirmMergeBody')} <strong>{t(CONFLICT_KEYS[onConflict])}</strong>.
            </Alert>
          )}

          <Box
            onClick={() => setAck((a) => !a)}
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
              checked={ack}
              size="small"
              sx={{ p: 0 }}
              onChange={() => setAck((a) => !a)}
              onClick={(e) => e.stopPropagation()}
              slotProps={{ input: { 'aria-label': t('import.ackAria') } }}
            />
            <Typography variant="body2">
              {mode === 'restore'
                ? t('import.ackRestore')
                : t('import.ackMerge')}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit" fullWidth>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            color={mode === 'restore' ? 'error' : 'primary'}
            fullWidth
            disabled={!ack || busy}
            startIcon={executeMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <UploadIcon />}
            onClick={confirmAndContinue}
            sx={{ fontWeight: 700 }}
          >
            {mode === 'restore' ? t('import.restoreImport') : t('import.startImport')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Restore exits through re-authentication — the step-up token goes out
          as `X-Step-Up` on the execute call that follows. */}
      <StepUpDialog
        open={stepUpOpen}
        reason={t('import.restoreStepUp')}
        onClose={() => setStepUpOpen(false)}
        onVerified={(token) => {
          setStepUpOpen(false);
          void execute(token);
        }}
      />
    </Box>
  );
};

export default ImportWizard;
