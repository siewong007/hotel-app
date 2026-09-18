// Desktop-only managed backup/restore card for the data-transfer page.
//
// The desktop build keeps rotating `hotel-backup-*.dump` (+ `-uploads.tar.gz`)
// pairs under the app's data directory; this card lists them, creates one on
// demand, and restores one after an explicit data-loss confirmation. Restores
// stop the backend sidecar first, so the app drops into the normal
// `DesktopServiceGate` restart screen mid-restore — the card's own "restoring"
// state is only what the user sees in the window before the gate takes over.
// When the backend comes back the page remounts and the mount-time refetch
// surfaces the fresh safety backup at the top of the list.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import {
  Backup as BackupIcon,
  FolderOpen as FolderOpenIcon,
  Restore as RestoreIcon,
} from '@mui/icons-material';
import { dateFormatter, useTranslation } from '../../../../i18n';
import { LogoLoader } from '../../../../components';
import {
  backupNow,
  listBackups,
  openBackupsFolder,
  restoreDatabase,
  shouldUseDesktopRuntime,
  type DesktopBackupInfo,
} from '../../../../desktop/runtimeApi';
import type { NotifyFn } from './types';
import { formatBytes } from './utils';

interface DesktopBackupsCardProps {
  notify: NotifyFn;
}

// Mirrors BACKUP_RETENTION_COUNT in hotel-desktop/src-tauri/src/postgres.rs —
// the retention count is not exposed over IPC, so the subtitle inlines it.
const MANAGED_BACKUP_RETENTION = 14;

/** Tauri command failures reject with a bare string, not an `Error`. */
const ipcErrorMessage = (error: unknown): string => {
  if (typeof error === 'string' && error.trim() !== '') return error;
  if (error instanceof Error && error.message) return error.message;
  return String(error);
};

const formatLocalDateTime = (rfc3339: string): string => {
  const parsed = new Date(rfc3339);
  if (Number.isNaN(parsed.getTime())) return rfc3339;
  return dateFormatter({ dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
};

const DesktopBackupsCard: React.FC<DesktopBackupsCardProps> = ({ notify }) => {
  const theme = useTheme();
  const { t, tOr } = useTranslation('common');
  // Double-gate: the page gates on this too, so the card renders nothing and
  // issues no IPC in browser builds.
  const [isDesktop] = useState(() => shouldUseDesktopRuntime());
  const [backups, setBackups] = useState<DesktopBackupInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<DesktopBackupInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBackups(await listBackups());
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  }, []);

  // Mount (and every remount after the service gate's restart screen) refetches
  // the list — a finished restore surfaces its fresh safety backup at the top.
  useEffect(() => {
    if (!isDesktop) return;
    void refresh();
  }, [isDesktop, refresh]);

  const handleBackupNow = async () => {
    setError(null);
    setBackingUp(true);
    try {
      const path = await backupNow();
      await refresh();
      const filename = path.split(/[\\/]/).pop() ?? path;
      notify(tOr('desktop.backups.backedUp', 'Backup created: {{filename}}', { filename }));
    } catch (err) {
      setError(ipcErrorMessage(err));
    } finally {
      setBackingUp(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openBackupsFolder();
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const handleConfirmRestore = async () => {
    const target = restoreTarget;
    setRestoreTarget(null);
    if (!target) return;

    setError(null);
    setRestoring(true);
    try {
      const summary = await restoreDatabase(target.filename);
      // Usually unreachable in production — the card unmounted when the
      // backend stopped and remount refetches instead. If the promise does
      // settle while still mounted, report and pull the new list.
      notify(
        tOr('desktop.backups.restored', 'Restored {{filename}}', {
          filename: summary.restored_backup,
        }),
      );
      await refresh();
    } catch (err) {
      setError(`${tOr('desktop.backups.restoreFailed', 'Restore failed')}: ${ipcErrorMessage(err)}`);
    } finally {
      setRestoring(false);
    }
  };

  if (!isDesktop) return null;

  const busy = backingUp || restoring;

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: 'background.paper',
        mt: 3,
      }}
    >
      <Box
        sx={{
          p: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 15 }}>
            {tOr('desktop.backups.title', 'Local backups')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12.5 }}>
            {tOr(
              'desktop.backups.subtitle',
              'Automatic database + file backups kept on this computer. Newest {{count}} kept.',
              { count: MANAGED_BACKUP_RETENTION },
            )}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<FolderOpenIcon />}
            onClick={handleOpenFolder}
            disabled={busy}
          >
            {tOr('desktop.backups.openFolder', 'Open backups folder')}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={
              backingUp ? <CircularProgress size={14} color="inherit" /> : <BackupIcon />
            }
            onClick={handleBackupNow}
            disabled={busy}
          >
            {tOr('desktop.backups.backUpNow', 'Back up now')}
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mx: 2, mt: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {restoring && (
        <Alert severity="warning" sx={{ mx: 2, mt: 2 }}>
          {tOr('desktop.backups.restoring', 'Restoring… the app will restart when it finishes.')}
        </Alert>
      )}

      {backups === null ? (
        <Box sx={{ p: 6, textAlign: 'center' }}>
          <LogoLoader variant="inline" />
        </Box>
      ) : backups.length === 0 ? (
        <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
          <BackupIcon sx={{ fontSize: 40, opacity: 0.4, mb: 1 }} />
          <Typography variant="body2">
            {tOr(
              'desktop.backups.empty',
              'No backups yet — the first one is created automatically about two minutes after startup.',
            )}
          </Typography>
        </Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {backups.map((backup) => (
            <Box
              component="li"
              key={backup.filename}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2,
                py: 1.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
                '&:last-child': { borderBottom: 0 },
                flexWrap: 'wrap',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <Typography
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: 12.5,
                    fontWeight: 600,
                    wordBreak: 'break-all',
                  }}
                >
                  {backup.filename}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {formatLocalDateTime(backup.timestamp)} · {formatBytes(backup.size_bytes)}
                </Typography>
              </Box>
              {backup.uploads_filename && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={tOr('desktop.backups.includesFiles', 'includes uploaded files')}
                  sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
                />
              )}
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<RestoreIcon />}
                onClick={() => setRestoreTarget(backup)}
                disabled={busy}
              >
                {tOr('desktop.backups.restore', 'Restore')}
              </Button>
            </Box>
          ))}
        </Box>
      )}

      <Dialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{tOr('desktop.backups.restoreConfirmTitle', 'Restore this backup?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {restoreTarget &&
              tOr(
                'desktop.backups.restoreConfirmBody',
                'The app restores {{filename}} ({{date}}). Data changed after that point is lost — a fresh safety backup is taken first so you can roll back. The app restarts during the restore.',
                {
                  filename: restoreTarget.filename,
                  date: formatLocalDateTime(restoreTarget.timestamp),
                },
              )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreTarget(null)} color="inherit">
            {t('actions.cancel')}
          </Button>
          <Button onClick={handleConfirmRestore} variant="contained" color="error" autoFocus>
            {tOr('desktop.backups.restoreConfirm', 'Restore and restart')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default DesktopBackupsCard;
