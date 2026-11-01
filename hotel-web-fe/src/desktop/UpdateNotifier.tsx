import { useEffect, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Snackbar, Stack, Typography } from '@mui/material';

import { useTranslation } from '../i18n';
import { describeUpdateError } from './describeUpdateError';
import {
  checkForUpdates,
  installUpdate,
  isDesktopUpdaterEnabled,
  restartApp,
  type DesktopUpdateInfo,
} from './runtimeApi';

/** Let the sidecar and first page settle before the first network check. */
export const UPDATE_CHECK_INITIAL_DELAY_MS = 15_000;
/** Re-check cadence for a front-desk machine that stays open for days. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type NotifierPhase = 'idle' | 'available' | 'installing' | 'installed' | 'restartDeferred';

interface UpdateNotifierProps {
  initialDelayMs?: number;
  intervalMs?: number;
}

/**
 * Background update check for the desktop staff shell. Checks once shortly
 * after launch and then on an interval; when a newer release exists it shows
 * a snackbar that runs the same install → restart flow as the System Health
 * "App updates" card. Check failures stay silent — an offline front desk
 * should not be nagged; the manual card still reports them. Returns null and
 * issues no IPC unless the desktop runtime AND the updater build flag are on.
 */
export function UpdateNotifier({
  initialDelayMs = UPDATE_CHECK_INITIAL_DELAY_MS,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
}: UpdateNotifierProps) {
  const { t } = useTranslation('common');
  const [isEnabled] = useState(() => isDesktopUpdaterEnabled());
  const [phase, setPhase] = useState<NotifierPhase>('idle');
  const [update, setUpdate] = useState<DesktopUpdateInfo | null>(null);
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  // "Later" hides this version until the next launch; a newer one re-opens it.
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stop polling once an install has started — the app is about to change.
  const isPolling = isEnabled && (phase === 'idle' || phase === 'available');

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    let cancelled = false;
    const runCheck = () => {
      checkForUpdates()
        .then((info) => {
          if (cancelled || !info.available) {
            return;
          }
          setUpdate(info);
          setPhase('available');
        })
        .catch(() => undefined);
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(() => {
      runCheck();
      intervalId = setInterval(runCheck, intervalMs);
    }, initialDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [isPolling, initialDelayMs, intervalMs]);

  const handleInstall = async () => {
    setPhase('installing');
    setError(null);

    try {
      // Windows: this promise never resolves — the updater exits the process
      // and the NSIS installer relaunches the app. Leaving "installing" up is
      // correct; a dropped promise is success-in-progress, not a failure.
      const outcome = await installUpdate();
      if (outcome.installed) {
        setInstalledVersion(outcome.version);
        setPhase('installed');
      } else {
        // The update disappeared between the check and the install.
        setUpdate(null);
        setPhase('idle');
      }
    } catch (installError) {
      setError(describeUpdateError(installError, t('desktop.updates.installFailed')));
      setPhase('available');
    }
  };

  const handleRestart = () => {
    // request_restart returns immediately and the app exits — a dropped
    // promise is expected here too, so it is deliberately not surfaced.
    restartApp().catch(() => undefined);
  };

  const handleLater = () => {
    setError(null);
    if (phase === 'installed') {
      // The install is on disk and applies on the next launch regardless;
      // stay quiet until then — a re-check would offer the same version.
      setPhase('restartDeferred');
      return;
    }
    setDismissedVersion(update?.version ?? null);
  };

  if (!isEnabled) {
    return null;
  }

  const open =
    phase === 'installing' ||
    phase === 'installed' ||
    (phase === 'available' && update !== null && update.version !== dismissedVersion);

  return (
    <Snackbar open={open} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
      <Alert
        severity={error ? 'error' : phase === 'installed' ? 'success' : 'info'}
        variant="outlined"
        sx={{ bgcolor: 'background.paper', width: { xs: '100%', sm: 380 } }}
      >
        {phase === 'available' && update && (
          <>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {t('desktop.updates.available', { version: update.version })}
            </Typography>
            {update.notes && (
              <Typography
                variant="body2"
                sx={{ mt: 0.5, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}
              >
                {update.notes}
              </Typography>
            )}
          </>
        )}

        {phase === 'installing' && (
          <Box>
            <Typography variant="body2">{t('desktop.updates.installing')}</Typography>
            <LinearProgress sx={{ mt: 1 }} />
          </Box>
        )}

        {phase === 'installed' && (
          <Typography variant="body2">
            {t('desktop.updates.installed', {
              version: installedVersion ?? update?.version ?? '',
            })}
          </Typography>
        )}

        {error && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {error}
          </Typography>
        )}

        {phase === 'available' && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="contained" onClick={handleInstall}>
              {t('desktop.updates.install')}
            </Button>
            <Button size="small" variant="text" onClick={handleLater}>
              {t('desktop.updates.remindLater')}
            </Button>
          </Stack>
        )}

        {phase === 'installed' && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button size="small" variant="contained" onClick={handleRestart}>
              {t('desktop.updates.restartNow')}
            </Button>
            <Button size="small" variant="text" onClick={handleLater}>
              {t('desktop.updates.restartLater')}
            </Button>
          </Stack>
        )}
      </Alert>
    </Snackbar>
  );
}
