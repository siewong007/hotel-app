import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
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
  isTauriRuntime,
  setRuntimeApiBaseUrl,
} from './runtimeApi';

interface DesktopServiceGateProps {
  children: React.ReactNode;
}

export function DesktopServiceGate({ children }: DesktopServiceGateProps) {
  const [isDesktop] = useState(() => isTauriRuntime());
  const [status, setStatus] = useState<DesktopAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);

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
      const { listen } = await import('@tauri-apps/api/event');

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
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('restart_backend');
      const nextStatus = await getDesktopStatus();
      setStatus(nextStatus);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : 'Unable to restart backend service');
    } finally {
      setIsRestarting(false);
    }
  };

  const openDataFolder = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_data_folder');
    } catch (folderError) {
      setError(folderError instanceof Error ? folderError.message : 'Unable to open data folder');
    }
  };

  if (!isDesktop || status?.backend_running) {
    return <>{children}</>;
  }

  const serviceLabel = status?.backend_starting || isRestarting ? 'Starting desktop services' : 'Desktop services are unavailable';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3 }}>
      <Box sx={{ width: '100%', maxWidth: 560, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 3, p: { xs: 3, sm: 4 } }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ width: 48, height: 48, borderRadius: 2, bgcolor: 'primary.main', display: 'grid', placeItems: 'center', color: 'primary.contrastText' }}>
              {status?.backend_starting || isRestarting ? <CircularProgress size={24} color="inherit" /> : <StorageIcon />}
            </Box>
            <Box>
              <Typography variant="h6">{serviceLabel}</Typography>
              <Typography variant="body2" color="text.secondary">
                {status?.backend_url || 'Waiting for the local API address'}
              </Typography>
            </Box>
          </Stack>

          {(status?.backend_starting || isRestarting) && <LinearProgress />}

          {error && <Alert severity="warning">{error}</Alert>}

          {status?.data_directory && (
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
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
