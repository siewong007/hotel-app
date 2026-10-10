import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
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
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        {/* Title over the button on phones: side by side, the subtitle wrapped
            to four lines and squeezed "Add Passkey" onto two. */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            alignItems: { xs: 'stretch', sm: 'flex-start' },
            gap: 2,
            mb: 2,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h6"
              component="h3"
              sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}
            >
              <FingerprintIcon aria-hidden />
              {t('passkeys.title', { count: passkeys.length, max: MAX_PASSKEYS })}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('passkeys.subtitle')}
            </Typography>
          </Box>
          {passkeys.length > 0 && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onAdd}
              disabled={atLimit}
              sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {t('passkeys.add')}
            </Button>
          )}
        </Box>

        {passkeys.length === 0 ? (
          <Box
            sx={{
              textAlign: 'center',
              py: { xs: 4, sm: 6 },
              px: 2,
              backgroundColor: 'background.default',
              borderRadius: 2,
            }}
          >
            <FingerprintIcon sx={{ fontSize: { xs: 48, sm: 64 }, color: 'text.secondary', mb: 1.5 }} />
            <Typography variant="subtitle1" gutterBottom sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {t('passkeys.empty')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
              {t('passkeys.emptyHint')}
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onAdd}
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              {t('passkeys.registerFirst')}
            </Button>
          </Box>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {passkeys.map((passkey, index) => {
              const deviceConfig = detectDeviceType(passkey.device_name || '');
              const isEditing = editingPasskey === passkey.id;
              return (
                <Box
                  component="li"
                  key={passkey.id}
                  sx={{
                    py: 1.5,
                    borderTop: index === 0 ? 'none' : '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <Box sx={{ flexShrink: 0 }}>
                      <DeviceIcon deviceName={passkey.device_name || ''} size={32} />
                    </Box>
                    {isEditing ? (
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <TextField
                          fullWidth
                          size="small"
                          value={passkeyName}
                          onChange={e => setPasskeyName(e.target.value)}
                          placeholder={t('passkeys.namePlaceholder')}
                          autoFocus
                        />
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 1 }}>
                          <IconButton onClick={cancelEditing} title={t('common:actions.cancel')}>
                            <CancelIcon />
                          </IconButton>
                          <IconButton
                            color="primary"
                            onClick={() => saveName(passkey.id)}
                            title={t('common:actions.save')}
                          >
                            <CheckIcon />
                          </IconButton>
                        </Box>
                      </Box>
                    ) : (
                      <>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box
                            sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}
                          >
                            <Typography
                              variant="subtitle1"
                              component="span"
                              sx={{ fontWeight: 600, overflowWrap: 'anywhere', lineHeight: 1.3 }}
                            >
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
                          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                            <strong>{t('passkeys.addedAt')}</strong> {formatHotelDate(passkey.created_at)}
                          </Typography>
                          {passkey.last_used_at ? (
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              {t('passkeys.lastUsed', { at: formatHotelDateTime(passkey.last_used_at) })}
                            </Typography>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                              {t('passkeys.neverUsed')}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', flexShrink: 0, mt: -0.5 }}>
                          <IconButton
                            onClick={() => startEditing(passkey.id, passkey.device_name || '')}
                            title={t('passkeys.editName')}
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            color="error"
                            onClick={() => onDelete(passkey.id)}
                            title={t('passkeys.delete')}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
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
