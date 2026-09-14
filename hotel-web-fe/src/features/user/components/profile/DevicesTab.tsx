import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import { Logout as LogoutIcon } from '@mui/icons-material';
import type { UserSessionInfo } from '../../../../types';
import { DeviceIcon, detectDeviceType } from './deviceIcons';
import { sessionActivityLine } from './sessionLocation';
import { useTranslation } from '../../../../i18n';

interface DevicesTabProps {
  sessions: UserSessionInfo[];
  onRevoke: (session: UserSessionInfo) => void;
}

const DevicesTab: React.FC<DevicesTabProps> = ({ sessions, onRevoke }) => {
  const { t } = useTranslation('auth');
  return (
  <Card>
    <CardContent>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
        {t('devices.title')}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 2
        }}>
        {t('devices.subtitle')}
      </Typography>
      {sessions.length === 0 ? (
        <Typography sx={{
          color: "text.secondary"
        }}>{t('devices.empty')}</Typography>
      ) : (
        <List>
          {sessions.map((session, index) => (
            <ListItem key={session.id} divider={index < sessions.length - 1}>
              <Box sx={{ mr: 2 }}>
                <DeviceIcon deviceName={session.user_agent || ''} size={42} />
              </Box>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography sx={{
                      fontWeight: 600
                    }}>
                      {detectDeviceType(session.user_agent || '').label}
                    </Typography>
                    {session.is_current && (
                      <Chip label={t('devices.current')} size="small" color="success" />
                    )}
                  </Box>
                }
                secondary={`${sessionActivityLine(session)}${
                  session.ip_address ? ` · ${session.ip_address}` : ''
                }`}
              />
              {!session.is_current && (
                <IconButton
                  color="error"
                  onClick={() => onRevoke(session)}
                  title={t('devices.revoke')}
                >
                  <LogoutIcon />
                </IconButton>
              )}
            </ListItem>
          ))}
        </List>
      )}
    </CardContent>
  </Card>
  );
};

export default DevicesTab;
