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
  Upload as UploadIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import type { ImportPreview, UploadResponse } from '../../../../types';
import { invalidateImportedData } from '../../../../api/queryInvalidation';
import {
  useDeleteUploadMutation,
  useExecuteImportMutation,
  useImportJob,
  useImportPreviewMutation,
  useUploadBackupMutation,
} from '../../hooks/useDataTransferQueries';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { MobileCardRow } from '../../../../components/data-table/MobileCardRow';
import { IMPORT_JOB_POLL_MS, MAX_BACKUP_FILE_BYTES } from './constants';
import type { NotifyFn, RecordHistoryFn } from './types';
import { formatBytes, formatNum, shortEntityName } from './utils';
import type { BackupImportMode, ConflictPolicy } from '../../../../types';

interface ImportWizardProps {
  notify: NotifyFn;
  onRecord: RecordHistoryFn;
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

const CONFLICT_LABELS: Record<ConflictPolicy, string> = {
  skip: 'Skip — keep the existing row',
  update: 'Update — overwrite the existing row',
  fail: 'Fail — abort the import on the first duplicate',
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const nullableCount = (value: number | null): string => (value === null ? '—' : formatNum(value));

const ImportWizard: React.FC<ImportWizardProps> = ({ notify, onRecord, onFinished, pollIntervalMs }) => {
  const theme = useTheme();
  const isPhone = useIsPhone();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('select');
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<BackupImportMode>('merge');
  const [onConflict, setOnConflict] = useState<ConflictPolicy>('skip');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ack, setAck] = useState(false);
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

  const scopeLabel = preview ? `${formatNum(preview.entities.length)} entities` : (file?.name ?? 'Backup file');

  // Record + surface terminal job states exactly once per job.
  useEffect(() => {
    if (!jobId || !job || job.status === 'running' || recordedJobRef.current === jobId) return;
    recordedJobRef.current = jobId;

    if (job.status === 'succeeded') {
      const inserted = job.result?.inserted ?? 0;
      const updated = job.result?.updated ?? 0;
      const skipped = job.result?.skipped ?? 0;
      invalidateImportedData(queryClient);
      onRecord({
        type: 'import',
        mode,
        jobId,
        categories: scopeLabel,
        records: inserted + updated + skipped,
        status: skipped > 0 ? 'partial' : 'success',
        error: skipped > 0 ? `${formatNum(skipped)} row(s) skipped — references could not be resolved.` : undefined,
      });
      notify(
        skipped > 0
          ? `Import finished — ${formatNum(skipped)} row(s) skipped.`
          : `Import completed — ${formatNum(inserted + updated)} row(s) applied.`,
        skipped > 0 ? 'warning' : 'success',
      );
    } else {
      onRecord({
        type: 'import',
        mode,
        jobId,
        categories: scopeLabel,
        records: 0,
        status: 'failed',
        error: job.error ?? 'Import failed',
      });
    }
    setStep('done');
  }, [job, jobId, mode, scopeLabel, notify, onRecord, queryClient]);

  const reset = () => {
    setFile(null);
    setUpload(null);
    setPreview(null);
    setJobId(null);
    setMode('merge');
    setOnConflict('skip');
    setAck(false);
    setConfirmOpen(false);
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
        setError(errorMessage(previewError, 'Failed to preview backup contents.'));
        setStep('select');
      }
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'Failed to upload backup file.'));
      setStep('select');
    }
  };

  const acceptFile = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    if (picked.size > MAX_BACKUP_FILE_BYTES) {
      setError(
        `"${picked.name}" is ${formatBytes(picked.size)} — backup files are limited to ${formatBytes(MAX_BACKUP_FILE_BYTES)}.`,
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

  const execute = async () => {
    if (!upload || !ack) return;
    try {
      const response = await executeMutation.mutateAsync({
        uploadId: upload.uploadId,
        mode,
        onConflict: mode === 'merge' ? onConflict : undefined,
      });
      setJobId(response.jobId);
      setConfirmOpen(false);
      setStep('running');
    } catch (err) {
      setConfirmOpen(false);
      setError(errorMessage(err, 'Failed to start the import.'));
    }
  };

  const blockedByValidation = (preview?.validationErrors.length ?? 0) > 0;
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
              <TableCell sx={{ fontWeight: 700 }}>Entity</TableCell>
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
        <Typography sx={{ fontWeight: 800, fontSize: 18 }}>Select a backup file to import</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 480 }}>
          Drop or choose a <strong>.json</strong> backup produced by this app (up to{' '}
          {formatBytes(MAX_BACKUP_FILE_BYTES)}). Its contents are previewed and confirmed before anything is written.
        </Typography>
      </Box>
      <Button variant="contained" component="label" startIcon={<UploadIcon />} sx={{ fontWeight: 700 }}>
        Select JSON file
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={handleFileInput}
          aria-label="Choose backup file"
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
      <LinearProgress aria-label="Uploading and analyzing backup" />
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {previewMutation.isPending ? 'Analyzing backup contents…' : 'Uploading backup file…'}
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
                  color={preview.format === 'v3' ? 'primary' : 'default'}
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
                />
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {[
                  preview.version !== null ? `format v${preview.version}` : null,
                  preview.exportedAt ? `exported ${new Date(preview.exportedAt).toLocaleString()}` : null,
                  preview.sourceEnvironment ? `from ${preview.sourceEnvironment}` : null,
                  preview.applicationVersion ? `app ${preview.applicationVersion}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Backup metadata unavailable'}
              </Typography>
            </Box>
          </Box>
          <Button
            color="inherit"
            startIcon={<CloseIcon />}
            onClick={discardAndReset}
            sx={{ color: 'text.secondary', fontWeight: 600 }}
          >
            Remove file
          </Button>
        </Paper>

        {preview.validationErrors.length > 0 && (
          <Alert severity="error" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>This file cannot be imported</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {preview.validationErrors.map((validationError) => (
                <li key={validationError}>{validationError}</li>
              ))}
            </Box>
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
              {formatNum(preview.relationshipProblems.reduce((sum, p) => sum + p.rows, 0))} row(s) will be skipped
            </AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {preview.relationshipProblems.map((problem) => (
                <li key={`${problem.entity}-${problem.reason}`}>
                  <strong>{shortEntityName(problem.entity)}</strong>: {formatNum(problem.rows)} row(s) — {problem.reason}
                </li>
              ))}
            </Box>
          </Alert>
        )}

        {preview.unsupportedEntities.length > 0 && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>Unrecognized entities are ignored</AlertTitle>
            {preview.unsupportedEntities.map(shortEntityName).join(', ')} — present in the file but not part of the
            transferable set; they are never applied.
          </Alert>
        )}

        {preview.format !== 'v3' && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            Legacy {preview.format} backup — per-row new/existing counts are unavailable for this format.
          </Alert>
        )}

        <Paper elevation={0} sx={cardSx}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Typography sx={{ fontWeight: 800, fontSize: 15 }}>
              {formatNum(preview.totalRows)} rows in {formatNum(preview.entities.length)} entities
            </Typography>
          </Box>
          {renderEntityTable(
            preview.entities.map((entity) => ({
              name: entity.name,
              cells: [entity.rows, entity.new, entity.existing, entity.skipped],
            })),
            ['Rows', 'New', 'Existing', 'Skipped'],
            'Entities in the backup file',
          )}
        </Paper>

        <Paper elevation={0} sx={{ ...cardSx, p: 2 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1.5 }}>Import mode</Typography>
          <ToggleButtonGroup
            value={mode}
            exclusive
            size="small"
            onChange={(_, value) => value && setMode(value)}
            aria-label="Import mode"
            sx={{ mb: mode === 'merge' ? 2 : 0 }}
          >
            <ToggleButton value="merge" sx={{ textTransform: 'none', fontWeight: 700 }}>
              Merge — add to existing data
            </ToggleButton>
            <ToggleButton value="restore" sx={{ textTransform: 'none', fontWeight: 700 }}>
              Restore — replace existing data
            </ToggleButton>
          </ToggleButtonGroup>

          {mode === 'merge' && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                When a row already exists:
              </Typography>
              <RadioGroup
                value={onConflict}
                onChange={(e) => setOnConflict(e.target.value as ConflictPolicy)}
                aria-label="Conflict policy"
              >
                {(Object.keys(CONFLICT_LABELS) as ConflictPolicy[]).map((policy) => (
                  <FormControlLabel
                    key={policy}
                    value={policy}
                    control={<Radio size="small" />}
                    label={CONFLICT_LABELS[policy]}
                  />
                ))}
              </RadioGroup>
            </Box>
          )}

          {mode === 'restore' && (
            <Alert severity="error" sx={{ borderRadius: 2, mt: 1.5 }}>
              <AlertTitle sx={{ fontWeight: 700 }}>Restore deletes existing data first</AlertTitle>
              Every row in the backup's entities — and in tables that depend on them — is deleted before the file's
              rows are inserted, including rows not present in the backup.
            </Alert>
          )}
        </Paper>

        <Paper
          elevation={0}
          sx={{ ...cardSx, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, p: 2 }}
        >
          <Button color="inherit" onClick={discardAndReset} sx={{ color: 'text.secondary', fontWeight: 600 }}>
            Choose a different file
          </Button>
          <Button
            variant="contained"
            onClick={openConfirm}
            disabled={blockedByValidation || busy}
            sx={{ fontWeight: 700 }}
          >
            Review &amp; import
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
          <Typography sx={{ fontWeight: 800, fontSize: 15 }}>Import running…</Typography>
        </Box>
        <LinearProgress
          variant={total > 0 ? 'determinate' : 'indeterminate'}
          value={total > 0 ? Math.min(100, (applied / total) * 100) : undefined}
          aria-label="Import progress"
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {progress?.entity
            ? `Applying ${shortEntityName(progress.entity)} — ${formatNum(applied)} of ${formatNum(total)} rows`
            : `${formatNum(applied)} of ${formatNum(total)} rows applied`}
        </Typography>
        {jobQuery.isError && (
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            Progress refresh failed — the import itself continues on the server and polling keeps retrying.
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
            <AlertTitle sx={{ fontWeight: 700 }}>Import failed — nothing was applied</AlertTitle>
            {job.error ?? 'The import failed.'} The import runs in a single transaction, so the database was left
            unchanged.
          </Alert>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
            <Button variant="outlined" onClick={onFinished} sx={{ fontWeight: 700 }}>
              View history
            </Button>
            <Button variant="contained" onClick={reset} sx={{ fontWeight: 700 }}>
              Start over
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
            <Typography sx={{ fontWeight: 800, fontSize: 16 }}>Import complete</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip label={`${formatNum(result?.inserted ?? 0)} inserted`} color="success" variant="outlined" sx={{ fontWeight: 700 }} />
            <Chip label={`${formatNum(result?.updated ?? 0)} updated`} variant="outlined" sx={{ fontWeight: 700 }} />
            <Chip
              label={`${formatNum(result?.skipped ?? 0)} skipped`}
              color={result?.skipped ? 'warning' : 'default'}
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          </Box>
        </Paper>

        {result && result.report.relationshipProblems.length > 0 && (
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            <AlertTitle sx={{ fontWeight: 700 }}>Rows skipped because their references are missing</AlertTitle>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {result.report.relationshipProblems.map((problem) => (
                <li key={`${problem.entity}-${problem.reason}`}>
                  <strong>{shortEntityName(problem.entity)}</strong>: {formatNum(problem.rows)} row(s) — {problem.reason}
                </li>
              ))}
            </Box>
          </Alert>
        )}

        {result && result.report.unsupportedEntities.length > 0 && (
          <Alert severity="info" sx={{ borderRadius: 2 }}>
            These entities in the file were not applied:{' '}
            {result.report.unsupportedEntities.map(shortEntityName).join(', ')}.
          </Alert>
        )}

        {result && result.report.entities.length > 0 && (
          <Paper elevation={0} sx={cardSx}>
            {renderEntityTable(
              result.report.entities.map((outcome) => ({
                name: outcome.entity,
                cells: [outcome.inserted, outcome.updated, outcome.skipped],
              })),
              ['Inserted', 'Updated', 'Skipped'],
              'Import results by entity',
            )}
          </Paper>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
          <Button variant="outlined" onClick={onFinished} sx={{ fontWeight: 700 }}>
            View history
          </Button>
          <Button variant="contained" onClick={reset} sx={{ fontWeight: 700 }}>
            Import another file
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
            {mode === 'restore' ? 'Confirm restore' : 'Confirm import'}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            You're about to {mode === 'restore' ? 'restore' : 'merge'}{' '}
            <strong>{formatNum(preview?.totalRows ?? 0)} rows</strong> across{' '}
            <strong>{formatNum(preview?.entities.length ?? 0)} entities</strong>. This action is logged to the
            transfer history.
          </Typography>

          {mode === 'restore' ? (
            <Alert severity="error" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
              <AlertTitle sx={{ fontWeight: 700 }}>This deletes existing data first</AlertTitle>
              Restore clears the backup's entities <em>and every table that depends on them</em> — including rows not
              present in the file — before inserting. Export a fresh backup first so you can roll back if needed.
            </Alert>
          ) : (
            <Alert severity="info" sx={{ textAlign: 'left', mb: 2, borderRadius: 2 }}>
              Merge inserts only new rows. Existing rows are handled per the conflict policy:{' '}
              <strong>{CONFLICT_LABELS[onConflict]}</strong>.
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
              slotProps={{ input: { 'aria-label': 'Acknowledge import warning' } }}
            />
            <Typography variant="body2">
              {mode === 'restore'
                ? 'I understand restore deletes existing data, and I have a current backup to roll back with.'
                : 'I understand this modifies live data and that the action will be recorded.'}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 3, pt: 0 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit" fullWidth>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={mode === 'restore' ? 'error' : 'primary'}
            fullWidth
            disabled={!ack || busy}
            startIcon={executeMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <UploadIcon />}
            onClick={execute}
            sx={{ fontWeight: 700 }}
          >
            {mode === 'restore' ? 'Restore & import' : 'Start import'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ImportWizard;
