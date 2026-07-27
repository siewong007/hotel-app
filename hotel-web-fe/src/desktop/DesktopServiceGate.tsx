import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorageIcon from '@mui/icons-material/Storage';
import {
  DesktopAppStatus,
  getDesktopStatus,
  getTauriCoreApi,
  getTauriEventApi,
  setRuntimeApiBaseUrl,
  shouldUseDesktopRuntime,
  upgradeDatabaseFromBackup,
} from './runtimeApi';

function formatLocalDateTime(rfc3339: string): string {
  const parsed = new Date(rfc3339);
  if (Number.isNaN(parsed.getTime())) {
    return rfc3339;
  }
  return parsed.toLocaleString();
}

interface DesktopServiceGateProps {
  children: React.ReactNode;
}

export function DesktopServiceGate({ children }: DesktopServiceGateProps) {
  const [isDesktop] = useState(() => shouldUseDesktopRuntime());
  const [status, setStatus] = useState<DesktopAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let cancelled = false;
    let pollHandle: number | undefined;
    let unlistenReady: (() => void) | undefined;
    let unlistenTerminated: (() => void) | undefined;
    let unlistenServicesError: (() => void) | undefined;

    const refreshStatus = async () => {
      try {
        const nextStatus = await getDesktopStatus();
        if (cancelled) {
          return;
        }

        setStatus(nextStatus);
        setError(null);

        if (nextStatus.backend_running) {
          window.clearInterval(pollHandle);
        }
      } catch (statusError) {
        if (!cancelled) {
          setError(statusError instanceof Error ? statusError.message : 'Unable to read desktop service status');
        }
      }
    };

    const setupEvents = async () => {
      const { listen } = await getTauriEventApi();

      unlistenReady = await listen<string>('backend-ready', (event) => {
        setRuntimeApiBaseUrl(event.payload);
        refreshStatus();
      });

      unlistenTerminated = await listen<number | null>('backend-terminated', (event) => {
        setStatus((previousStatus) => previousStatus ? { ...previousStatus, backend_running: false, backend_starting: false } : previousStatus);
        setError(`Backend service stopped${event.payload === null ? '' : ` with code ${event.payload}`}`);
        pollHandle = window.setInterval(refreshStatus, 1500);
      });

      unlistenServicesError = await listen<string>('desktop-services-error', (event) => {
        setError(event.payload);
        setStatus((previousStatus) => previousStatus ? { ...previousStatus, backend_running: false, backend_starting: false } : previousStatus);
      });
    };

    refreshStatus();
    pollHandle = window.setInterval(refreshStatus, 1500);
    setupEvents().catch((eventError) => {
      setError(eventError instanceof Error ? eventError.message : 'Unable to subscribe to desktop service events');
    });

    return () => {
      cancelled = true;
      window.clearInterval(pollHandle);
      unlistenReady?.();
      unlistenTerminated?.();
      unlistenServicesError?.();
    };
  }, [isDesktop]);

  const restartBackend = async () => {
    setIsRestarting(true);
    setError(null);

    try {
      const { invoke } = await getTauriCoreApi();
      await invoke('restart_backend');
      const nextStatus = await getDesktopStatus();
      setStatus(nextStatus);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : 'Unable to restart backend service');
    } finally {
      setIsRestarting(false);
    }
  };

  const runUpgrade = async () => {
    setIsUpgrading(true);
    setUpgradeError(null);

    try {
      await upgradeDatabaseFromBackup();
      // Resume normal boot: refresh status; the backend is started by the command.
      const nextStatus = await getDesktopStatus();
      setStatus(nextStatus);
      setError(null);
    } catch (err) {
      setUpgradeError(err instanceof Error ? err.message : 'Database upgrade failed');
    } finally {
      setIsUpgrading(false);
    }
  };

  const openDataFolder = async () => {
    try {
      const { invoke } = await getTauriCoreApi();
      await invoke('open_data_folder');
    } catch (folderError) {
      setError(folderError instanceof Error ? folderError.message : 'Unable to open data folder');
    }
  };

  if (!isDesktop || status?.backend_running) {
    return <>{children}</>;
  }

  const pg = status?.postgres;
  const needsUpgrade = Boolean(pg?.needs_upgrade);
  const latestBackup = pg?.latest_backup ?? null;

  if (needsUpgrade) {
    const fromVersion = pg?.data_dir_major ?? 'an older version';
    const toVersion = pg?.bundled_major ?? 'the current version';

    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3 }}>
        <Dialog open maxWidth="sm" fullWidth>
          <DialogTitle>Database upgrade required</DialogTitle>
          <DialogContent>
            <DialogContentText component="div">
              <Typography variant="body2" gutterBottom>
                Your saved data was created with PostgreSQL {fromVersion}, but this
                version of the app ships PostgreSQL {toVersion}. The app cannot open
                the existing data directly and will not start until this is resolved.
              </Typography>

              {latestBackup ? (
                <Typography variant="body2" sx={{ mt: 2 }}>
                  Restore from backup taken {formatLocalDateTime(latestBackup.timestamp)}?
                  Changes made after that date will be lost. Your existing data
                  directory is kept (renamed aside), not deleted.
                </Typography>
              ) : (
                <Typography variant="body2" sx={{ mt: 2 }}>
                  No automatic backup is available, so the app cannot upgrade safely.
                  To recover, install a desktop build matching PostgreSQL {fromVersion}
                  to read the existing data, or migrate the data directory manually
                  with pg_upgrade. Your existing data has been left untouched.
                </Typography>
              )}

              {isUpgrading && (
                <Box sx={{ mt: 2 }}>
                  <LinearProgress />
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      mt: 1
                    }}>
                    Upgrading database. This may take a few minutes; do not close the app.
                  </Typography>
                </Box>
              )}

              {upgradeError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {upgradeError}
                </Alert>
              )}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button startIcon={<FolderOpenIcon />} onClick={openDataFolder} disabled={isUpgrading}>
              Open data folder
            </Button>
            {latestBackup && (
              <>
                <Button onClick={restartBackend} disabled={isUpgrading}>
                  Retry without upgrading
                </Button>
                <Button variant="contained" onClick={runUpgrade} disabled={isUpgrading}>
                  Restore from backup
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  const serviceLabel = status?.backend_starting || isRestarting ? 'Starting desktop services' : 'Desktop services are unavailable';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3 }}>
      <Box sx={{ width: '100%', maxWidth: 560, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 3, p: { xs: 3, sm: 4 } }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={2} sx={{
            alignItems: "center"
          }}>
            <Box sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: 'primary.main', display: 'grid', placeItems: 'center', color: 'primary.contrastText' }}>
              {status?.backend_starting || isRestarting ? <CircularProgress size={24} color="inherit" /> : <StorageIcon />}
            </Box>
            <Box>
              <Typography variant="h6">{serviceLabel}</Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {status?.backend_url || 'Waiting for the local API address'}
              </Typography>
            </Box>
          </Stack>

          {(status?.backend_starting || isRestarting) && <LinearProgress />}

          {error && <Alert severity="warning">{error}</Alert>}

          {status?.data_directory && (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                wordBreak: 'break-all'
              }}>
              Data folder: {status.data_directory}
            </Typography>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button startIcon={<RefreshIcon />} variant="contained" onClick={restartBackend} disabled={isRestarting}>
              Restart services
            </Button>
            <Button startIcon={<FolderOpenIcon />} variant="outlined" onClick={openDataFolder}>
              Open data folder
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
