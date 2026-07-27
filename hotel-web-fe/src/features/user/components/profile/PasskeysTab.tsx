import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Cancel as CancelIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Fingerprint as FingerprintIcon,
} from '@mui/icons-material';
import type { PasskeyInfo } from '../../../../types';
import { ApiNotificationSeverity } from '../../../../utils/apiNotifications';
import { DeviceIcon, detectDeviceType } from './deviceIcons';

export const MAX_PASSKEYS = 10;

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

interface PasskeysTabProps {
  passkeys: PasskeyInfo[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, deviceName: string) => Promise<void>;
  notify: (message: string, severity: ApiNotificationSeverity) => void;
}

const PasskeysTab: React.FC<PasskeysTabProps> = ({
  passkeys,
  onAdd,
  onDelete,
  onRename,
  notify,
}) => {
  const [editingPasskey, setEditingPasskey] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState('');
  const atLimit = passkeys.length >= MAX_PASSKEYS;

  const startEditing = (id: string, currentName: string) => {
    setEditingPasskey(id);
    setPasskeyName(currentName || '');
  };

  const cancelEditing = () => {
    setEditingPasskey(null);
    setPasskeyName('');
  };

  const saveName = async (id: string) => {
    if (!passkeyName.trim()) {
      notify('Passkey name cannot be empty', 'warning');
      return;
    }
    await onRename(id, passkeyName);
    cancelEditing();
  };

  return (
    <Card>
      <CardContent>
        <Box
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Registered Passkeys ({passkeys.length}/{MAX_PASSKEYS})
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              Passkeys provide secure, passwordless authentication
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} disabled={atLimit}>
            Add Passkey
          </Button>
        </Box>

        {passkeys.length === 0 ? (
          <Box
            sx={{
              textAlign: 'center',
              py: 6,
              backgroundColor: 'background.default',
              borderRadius: 2,
            }}
          >
            <FingerprintIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom sx={{
              color: "text.secondary"
            }}>
              No passkeys registered
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 3
              }}>
              Add a passkey for secure, passwordless login
            </Typography>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={onAdd}>
              Register Your First Passkey
            </Button>
          </Box>
        ) : (
          <List>
            {passkeys.map((passkey, index) => {
              const deviceConfig = detectDeviceType(passkey.device_name || '');
              const isEditing = editingPasskey === passkey.id;
              return (
                <ListItem
                  key={passkey.id}
                  divider={index < passkeys.length - 1}
                  sx={{
                    py: 2.5,
                    px: 2,
                    borderRadius: 2,
                    mb: 1,
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                      transform: 'translateX(4px)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    },
                  }}
                >
                  <Box sx={{ mr: 2 }}>
                    <DeviceIcon deviceName={passkey.device_name || ''} size={48} />
                  </Box>
                  {isEditing ? (
                    <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TextField
                        size="small"
                        value={passkeyName}
                        onChange={e => setPasskeyName(e.target.value)}
                        placeholder="Device name (e.g., MacBook Pro, iPhone 15, YubiKey)"
                        autoFocus
                        sx={{ flexGrow: 1 }}
                      />
                      <IconButton color="primary" onClick={() => saveName(passkey.id)} title="Save">
                        <CheckIcon />
                      </IconButton>
                      <IconButton onClick={cancelEditing} title="Cancel">
                        <CancelIcon />
                      </IconButton>
                    </Box>
                  ) : (
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {passkey.device_name || 'Unnamed Device'}
                          </Typography>
                          <Chip
                            label={deviceConfig.label}
                            size="small"
                            sx={{
                              background: deviceConfig.gradient,
                              color: 'white',
                              fontWeight: 500,
                              fontSize: '0.7rem',
                              height: 20,
                            }}
                          />
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              color: "text.secondary",
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5
                            }}>
                            <strong>Added:</strong> {formatDate(passkey.created_at)}
                          </Typography>
                          {passkey.last_used_at ? (
                            <Typography
                              variant="body2"
                              sx={{
                                color: "text.secondary",
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5
                              }}>
                              <strong>Last used:</strong> {formatDate(passkey.last_used_at)} at{' '}
                              {formatTime(passkey.last_used_at)}
                            </Typography>
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{
                                color: "text.secondary",
                                fontStyle: 'italic'
                              }}>
                              Never used
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                  )}
                  <ListItemSecondaryAction>
                    {!isEditing && (
                      <>
                        <IconButton
                          edge="end"
                          onClick={() => startEditing(passkey.id, passkey.device_name || '')}
                          title="Edit passkey name"
                          sx={{
                            mr: 1,
                            '&:hover': {
                              backgroundColor: 'primary.light',
                              color: 'primary.contrastText',
                            },
                          }}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          edge="end"
                          color="error"
                          onClick={() => onDelete(passkey.id)}
                          title="Delete passkey"
                          sx={{
                            '&:hover': {
                              backgroundColor: 'error.light',
                              color: 'error.contrastText',
                            },
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </>
                    )}
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
          </List>
        )}

        {atLimit && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Maximum number of passkeys reached ({MAX_PASSKEYS}/{MAX_PASSKEYS}). Delete a passkey to
            add a new one.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default PasskeysTab;
