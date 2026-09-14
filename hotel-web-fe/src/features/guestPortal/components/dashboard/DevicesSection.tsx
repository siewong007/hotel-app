import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';

import { useConfirm } from '../../../../components/common/ConfirmProvider';
import type { UserSessionInfo } from '../../../../types';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { guestErrorMessage } from '../../utils/feedback';
import { useTranslation } from '../../../../i18n';
import {
  useRevokeSessionMutation,
  useSessionsQuery,
} from '../../../user/hooks/useProfileQueries';
import { DeviceIcon, detectDeviceType } from '../../../user/components/profile/deviceIcons';
import { sessionActivityLine } from '../../../user/components/profile/sessionLocation';
import { ErrorState } from './PortalDashboardSections';


function notify(message: string, severity: 'success' | 'error') {
  emitApiNotification({ message, severity });
}

function DeviceRow({
  session,
  onRevoke,
  revoking,
}: {
  session: UserSessionInfo;
  onRevoke: (session: UserSessionInfo) => void;
  revoking: boolean;
}) {
  const { t } = useTranslation('guestPortal');
  const device = detectDeviceType(session.user_agent || '');
  return (
    <Box
      component="li"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        py: 2,
        listStyle: 'none',
        flexWrap: { xs: 'wrap', sm: 'nowrap' },
      }}
    >
      <DeviceIcon deviceName={session.user_agent || ''} size={42} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ color: 'var(--hotel-text)', fontWeight: 600 }}>{device.label}</Typography>
          {session.is_current ? (
            <Chip label={t('dashboard.devices.thisDevice')} size="small" color="success" />
          ) : null}
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
          {sessionActivityLine(session)}
        </Typography>
        {session.ip_address ? (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('dashboard.devices.ip', { address: session.ip_address })}
          </Typography>
        ) : null}
      </Box>
      {/* No control on the current session: signing yourself out from a device
          list is the "log out" button's job, and offering it here reads as a
          way to end someone else's session. */}
      {!session.is_current ? (
        <Button
          size="small"
          color="error"
          variant="outlined"
          startIcon={<LogoutOutlinedIcon />}
          disabled={revoking}
          onClick={() => onRevoke(session)}
        >
          {t('dashboard.devices.signOut')}
        </Button>
      ) : null}
    </Box>
  );
}

/**
 * Every device currently signed in to the guest's account, with the
 * approximate place each signed in from, and a way to end any of them.
 *
 * Like `SecuritySection` this takes no portal token: sessions belong to the
 * ACCOUNT, and `/api/profile/sessions` authenticates with the ordinary account
 * session `AuthContext` holds. The portal bearer token would not be accepted.
 */
export function DevicesSection() {
  const { t } = useTranslation('guestPortal');
  const confirm = useConfirm();
  // The section renders its own ErrorState + retry, so a failed load should
  // not ALSO raise the client's global toast.
  const sessionsQuery = useSessionsQuery({ suppressApiNotification: true });
  const revokeSession = useRevokeSessionMutation({ suppressApiNotification: true });

  const sessions: UserSessionInfo[] = sessionsQuery.data ?? [];

  const handleRevoke = async (session: UserSessionInfo) => {
    const accepted = await confirm({
      title: t('dashboard.devices.confirmTitle'),
      message: t('dashboard.devices.confirmBody'),
      confirmText: t('dashboard.devices.confirmButton'),
      cancelText: t('common:actions.cancel'),
      severity: 'warning',
    });
    if (!accepted) return;
    try {
      await revokeSession.mutateAsync(session.id);
      notify(t('dashboard.devices.signedOut'), 'success');
    } catch (error) {
      notify(guestErrorMessage(error, t('dashboard.devices.signOutFailed')), 'error');
    }
  };

  return (
    <Paper
      component="section"
      aria-label={t('dashboard.devices.aria')}
      variant="outlined"
      sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, bgcolor: 'var(--hotel-surface-raised)' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
        <Box sx={{ color: 'var(--hotel-primary-text)', lineHeight: 0, mt: 0.25 }}>
          <DevicesOutlinedIcon />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h3" sx={{ color: 'var(--hotel-text)', fontWeight: 700 }}>
            {t('dashboard.devices.title')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('dashboard.devices.description')}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ my: 2.5 }} />

      {sessionsQuery.isPending ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
          <CircularProgress size={22} />
          <Typography sx={{ color: 'text.secondary' }}>{t('dashboard.devices.loading')}</Typography>
        </Box>
      ) : sessionsQuery.isError ? (
        <ErrorState
          message={t('dashboard.devices.loadFailed')}
          retry={() => void sessionsQuery.refetch()}
        />
      ) : sessions.length === 0 ? (
        <Typography sx={{ color: 'text.secondary' }}>
          {t('dashboard.devices.empty')}
        </Typography>
      ) : (
        <Stack component="ul" divider={<Divider />} sx={{ m: 0, p: 0 }}>
          {sessions.map((session) => (
            <DeviceRow
              key={session.id}
              session={session}
              onRevoke={(target) => void handleRevoke(target)}
              revoking={revokeSession.isPending}
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}

export default DevicesSection;
