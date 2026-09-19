import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';

import { useTranslation } from '../i18n';
import {
  checkForUpdates,
  getDesktopStatus,
  installUpdate,
  isDesktopUpdaterEnabled,
  restartApp,
  type DesktopUpdateInfo,
} from './runtimeApi';

type UpdatePhase = 'idle' | 'checking' | 'available' | 'installing' | 'installed';

/** Tauri invoke rejections arrive as plain strings, not Error instances. */
function describeError(cause: unknown, fallback: string): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string' && cause) {
    return cause;
  }
  return fallback;
}

/**
 * "App updates" card for the system-health grid. Rendered as a full-width
 * grid item so the page can mount it inline; returns null — no wrapper, no
 * IPC — unless the desktop runtime AND the updater build flag are both on.
 */
export function UpdateChecker() {
  const { t } = useTranslation('common');
  const [isEnabled] = useState(() => isDesktopUpdaterEnabled());
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [update, setUpdate] = useState<DesktopUpdateInfo | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [isUpToDate, setIsUpToDate] = useState(false);
  const [restartDismissed, setRestartDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    let cancelled = false;
    getDesktopStatus()
      .then((status) => {
        if (!cancelled) {
          setCurrentVersion(status.version);
        }
      })
      // The version line is best-effort; the check flow refreshes it anyway.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  const handleCheck = async () => {
    setPhase('checking');
    setError(null);
    setIsUpToDate(false);

    try {
      const info = await checkForUpdates();
      setCurrentVersion(info.current_version);
      if (info.available) {
        setUpdate(info);
        setPhase('available');
      } else {
        setUpdate(null);
        setIsUpToDate(true);
        setPhase('idle');
      }
    } catch (checkError) {
      setError(describeError(checkError, t('desktop.updates.checkFailed')));
      setPhase(update ? 'available' : 'idle');
    }
  };

  const handleInstall = async () => {
    setPhase('installing');
    setError(null);

    try {
      // Windows: this promise never resolves — the updater exits the process
      // and the NSIS installer relaunches the app, so the "installing" state
      // is simply the last thing the user sees. Leaving it up is correct; a
      // dropped promise is success-in-progress, not a failure.
      const outcome = await installUpdate();
      if (outcome.installed) {
        setInstalledVersion(outcome.version);
        setRestartDismissed(false);
        setPhase('installed');
      } else {
        // The update disappeared between the check and the install.
        setUpdate(null);
        setIsUpToDate(true);
        setPhase('idle');
      }
    } catch (installError) {
      setError(describeError(installError, t('desktop.updates.installFailed')));
      setPhase(update ? 'available' : 'idle');
    }
  };

  const handleRestart = () => {
    // request_restart returns immediately and the app exits — a dropped
    // promise is expected here too, so it is deliberately not surfaced.
    restartApp().catch(() => undefined);
  };

  if (!isEnabled) {
    return null;
  }

  return (
    <Grid size={{ xs: 12 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            {t('desktop.updates.title')}
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {currentVersion ? `v${currentVersion}` : '—'}
          </Typography>

          {isUpToDate && currentVersion && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {t('desktop.updates.upToDate', { version: currentVersion })}
            </Alert>
          )}

          {phase === 'available' && update && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t('desktop.updates.available', { version: update.version })}
              {update.notes && (
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                  {update.notes}
                </Typography>
              )}
            </Alert>
          )}

          {phase === 'installing' && (
            <Box sx={{ mb: 2 }}>
              <LinearProgress />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('desktop.updates.installing')}
              </Typography>
            </Box>
          )}

          {phase === 'installed' && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {t('desktop.updates.installed', {
                version: installedVersion ?? update?.version ?? '',
              })}
            </Alert>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={1.5}>
            {(phase === 'idle' || phase === 'checking') && (
              <Button
                variant="contained"
                onClick={handleCheck}
                disabled={phase === 'checking'}
              >
                {phase === 'checking'
                  ? t('desktop.updates.checking')
                  : t('desktop.updates.check')}
              </Button>
            )}

            {phase === 'available' && (
              <>
                <Button variant="contained" onClick={handleInstall}>
                  {t('desktop.updates.install')}
                </Button>
                <Button variant="text" onClick={handleCheck}>
                  {t('desktop.updates.check')}
                </Button>
              </>
            )}

            {phase === 'installed' && !restartDismissed && (
              <>
                <Button variant="contained" onClick={handleRestart}>
                  {t('desktop.updates.restartNow')}
                </Button>
                <Button variant="text" onClick={() => setRestartDismissed(true)}>
                  {t('desktop.updates.restartLater')}
                </Button>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Grid>
  );
}
