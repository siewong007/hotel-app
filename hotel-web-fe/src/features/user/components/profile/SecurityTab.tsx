import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Grid, TextField, Typography } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { ApiNotificationSeverity } from '../../../../utils/apiNotifications';
import { useTranslation } from '../../../../i18n';

const MIN_PASSWORD_LENGTH = 8;

const EMPTY_FORM = {
  current_password: '',
  new_password: '',
  confirm_password: '',
};

interface SecurityTabProps {
  onUpdatePassword: (data: { current_password: string; new_password: string }) => Promise<void>;
  notify: (message: string, severity: ApiNotificationSeverity) => void;
}

const SecurityTab: React.FC<SecurityTabProps> = ({ onUpdatePassword, notify }) => {
  const { t } = useTranslation('auth');
  const [passwordData, setPasswordData] = useState(EMPTY_FORM);
  const [showNewPasswordFields, setShowNewPasswordFields] = useState(false);

  const reset = () => {
    setPasswordData(EMPTY_FORM);
    setShowNewPasswordFields(false);
  };

  const handleCurrentPasswordSubmit = () => {
    if (!passwordData.current_password) {
      notify(t('security.enterCurrentPassword'), 'warning');
      return;
    }
    if (passwordData.current_password.length < 3) {
      notify(t('security.enterValidPassword'), 'warning');
      return;
    }
    setShowNewPasswordFields(true);
  };

  const handleSubmit = async () => {
    if (!passwordData.current_password || !passwordData.new_password) {
      notify(t('security.fillAllFields'), 'warning');
      return;
    }
    if (passwordData.new_password !== passwordData.confirm_password) {
      notify(t('security.passwordsMismatch'), 'warning');
      return;
    }
    if (passwordData.new_password.length < MIN_PASSWORD_LENGTH) {
      notify(t('validation:passwordTooShort', { min: MIN_PASSWORD_LENGTH }), 'warning');
      return;
    }

    await onUpdatePassword({
      current_password: passwordData.current_password,
      new_password: passwordData.new_password,
    });
    reset();
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 3 }}>
          {t('security.changePassword')}
        </Typography>
        <Grid container spacing={3}>
          <Grid size={12}>
            <TextField
              fullWidth
              type="password"
              label={t('security.currentPassword')}
              value={passwordData.current_password}
              onChange={e =>
                setPasswordData({ ...passwordData, current_password: e.target.value })
              }
              disabled={showNewPasswordFields}
              helperText={
                !showNewPasswordFields ? t('security.currentPasswordHint') : ''
              }
            />
          </Grid>

          {!showNewPasswordFields && (
            <Grid size={12}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                  variant="contained"
                  onClick={handleCurrentPasswordSubmit}
                  disabled={!passwordData.current_password}
                >
                  {t('common:actions.continue')}
                </Button>
              </Box>
            </Grid>
          )}

          {showNewPasswordFields && (
            <>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  type="password"
                  label={t('security.newPassword')}
                  value={passwordData.new_password}
                  onChange={e =>
                    setPasswordData({ ...passwordData, new_password: e.target.value })
                  }
                  helperText={t('security.minChars', { min: MIN_PASSWORD_LENGTH })}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  type="password"
                  label={t('security.confirmNewPassword')}
                  value={passwordData.confirm_password}
                  onChange={e =>
                    setPasswordData({ ...passwordData, confirm_password: e.target.value })
                  }
                />
              </Grid>
            </>
          )}
        </Grid>

        {showNewPasswordFields && (
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            <Button variant="outlined" onClick={reset}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="contained"
              startIcon={<LockIcon />}
              onClick={handleSubmit}
              disabled={!passwordData.new_password || !passwordData.confirm_password}
            >
              {t('security.updatePassword')}
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default SecurityTab;
