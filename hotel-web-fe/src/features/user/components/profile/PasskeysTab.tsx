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
import { useTranslation } from '../../../../i18n';
import { formatHotelDate, formatHotelDateTime } from '../../../../utils/date';

export const MAX_PASSKEYS = 10;

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
  const { t } = useTranslation('auth');
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
      notify(t('passkeys.nameEmpty'), 'warning');
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
              {t('passkeys.title', { count: passkeys.length, max: MAX_PASSKEYS })}
            </Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('passkeys.subtitle')}
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} disabled={atLimit}>
            {t('passkeys.add')}
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
              {t('passkeys.empty')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 3
              }}>
              {t('passkeys.emptyHint')}
            </Typography>
            <Button variant="outlined" startIcon={<AddIcon />} onClick={onAdd}>
              {t('passkeys.registerFirst')}
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
                      boxShadow: 'var(--hotel-shadow-sm)',
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
                        placeholder={t('passkeys.namePlaceholder')}
                        autoFocus
                        sx={{ flexGrow: 1 }}
                      />
                      <IconButton color="primary" onClick={() => saveName(passkey.id)} title={t('common:actions.save')}>
                        <CheckIcon />
                      </IconButton>
                      <IconButton onClick={cancelEditing} title={t('common:actions.cancel')}>
                        <CancelIcon />
                      </IconButton>
                    </Box>
                  ) : (
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {passkey.device_name || t('passkeys.unnamed')}
                          </Typography>
                          <Chip
                            label={deviceConfig.label}
                            size="small"
                            sx={{
                              background: deviceConfig.gradient,
                              color: deviceConfig.color,
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
                            <strong>{t('passkeys.addedAt')}</strong> {formatHotelDate(passkey.created_at)}
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
                              {t('passkeys.lastUsed', { at: formatHotelDateTime(passkey.last_used_at) })}
                            </Typography>
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{
                                color: "text.secondary",
                                fontStyle: 'italic'
                              }}>
                              {t('passkeys.neverUsed')}
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
                          title={t('passkeys.editName')}
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
                          title={t('passkeys.delete')}
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
            {t('passkeys.limitAlert', { count: MAX_PASSKEYS, max: MAX_PASSKEYS })}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default PasskeysTab;
