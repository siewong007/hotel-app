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

interface DevicesTabProps {
  sessions: UserSessionInfo[];
  onRevoke: (session: UserSessionInfo) => void;
}

const DevicesTab: React.FC<DevicesTabProps> = ({ sessions, onRevoke }) => (
  <Card>
    <CardContent>
      <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
        Signed-in devices
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Log out devices you no longer use. Their access ends immediately.
      </Typography>
      {sessions.length === 0 ? (
        <Typography color="text.secondary">No active sessions found.</Typography>
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
                    <Typography fontWeight={600}>
                      {detectDeviceType(session.user_agent || '').label}
                    </Typography>
                    {session.is_current && (
                      <Chip label="Current device" size="small" color="success" />
                    )}
                  </Box>
                }
                secondary={`Last active: ${new Date(
                  session.last_used_at || session.created_at
                ).toLocaleString()}${session.ip_address ? ` · ${session.ip_address}` : ''}`}
              />
              {!session.is_current && (
                <IconButton
                  color="error"
                  onClick={() => onRevoke(session)}
                  title="Log out device"
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

export default DevicesTab;
