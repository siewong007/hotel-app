import React from 'react';
import { Box, Card, CardContent, Chip, IconButton, Typography } from '@mui/material';
import { Devices as DevicesIcon, Logout as LogoutIcon } from '@mui/icons-material';
import type { UserSessionInfo } from '../../../../types';
import { DeviceIcon, detectDeviceType } from './deviceIcons';
import { sessionActivityLine } from './sessionLocation';
import { useTranslation } from '../../../../i18n';

interface DevicesTabProps {
  sessions: UserSessionInfo[];
  onRevoke: (session: UserSessionInfo) => void;
}

/**
 * Signed-in sessions as stacked rows. The activity line and the IP sit on
 * their own lines and break anywhere: an IPv6 address is one unbreakable
 * 39-character word that used to run off the right edge of a phone.
 */
const DevicesTab: React.FC<DevicesTabProps> = ({ sessions, onRevoke }) => {
  const { t } = useTranslation('auth');
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography
          variant="h6"
          component="h2"
          sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <DevicesIcon aria-hidden />
          {t('devices.title')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {t('devices.subtitle')}
        </Typography>
        {sessions.length === 0 ? (
          <Typography sx={{ color: 'text.secondary', py: 2 }}>{t('devices.empty')}</Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {sessions.map((session, index) => (
              <Box
                component="li"
                key={session.id}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  py: 1.5,
                  borderTop: index === 0 ? 'none' : '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ flexShrink: 0 }}>
                  <DeviceIcon deviceName={session.user_agent || ''} size={32} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}
                  >
                    <Typography component="span" sx={{ fontWeight: 600 }}>
                      {detectDeviceType(session.user_agent || '').label}
                    </Typography>
                    {session.is_current && (
                      <Chip label={t('devices.current')} size="small" color="success" />
                    )}
                  </Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                    {sessionActivityLine(session)}
                  </Typography>
                  {session.ip_address && (
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'text.secondary',
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {session.ip_address}
                    </Typography>
                  )}
                </Box>
                {!session.is_current && (
                  <IconButton
                    color="error"
                    onClick={() => onRevoke(session)}
                    title={t('devices.revoke')}
                    aria-label={t('devices.revoke')}
                    sx={{ flexShrink: 0, mt: -0.5 }}
                  >
                    <LogoutIcon />
                  </IconButton>
                )}
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default DevicesTab;
