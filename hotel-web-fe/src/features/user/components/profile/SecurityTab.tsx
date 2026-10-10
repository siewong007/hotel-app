import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Grid, TextField, Typography } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { ApiNotificationSeverity } from '../../../../utils/apiNotifications';
import { useTranslation } from '../../../../i18n';
import { PASSWORD_MIN_LENGTH, validatePassword } from '../../../../utils/validation';

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
    const passwordError = validatePassword(passwordData.new_password);
    if (passwordError) {
      notify(passwordError, 'warning');
      return;
    }

    try {
      await onUpdatePassword({
        current_password: passwordData.current_password,
        new_password: passwordData.new_password,
      });
      reset();
    } catch {
      // The parent notifies; keep the entered fields so they can be fixed.
    }
  };

  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
        <Typography
          variant="h6"
          component="h3"
          sx={{ fontWeight: 600, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}
        >
          <LockIcon aria-hidden />
          {t('security.changePassword')}
        </Typography>
        <Grid container spacing={{ xs: 2, sm: 3 }}>
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
              autoComplete="current-password"
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
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  {t('common:actions.continue')}
                </Button>
              </Box>
            </Grid>
          )}

          {showNewPasswordFields && (
            <>
              <Grid size={12}>
                <TextField
                  fullWidth
                  type="password"
                  autoComplete="new-password"
                  label={t('security.newPassword')}
                  value={passwordData.new_password}
                  onChange={e =>
                    setPasswordData({ ...passwordData, new_password: e.target.value })
                  }
                  helperText={t('security.passwordRequirements', { min: PASSWORD_MIN_LENGTH })}
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  type="password"
                  autoComplete="new-password"
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
          // Phones: full-width buttons, primary on top where the thumb is.
          <Box
            sx={{
              mt: 3,
              display: 'flex',
              flexDirection: { xs: 'column-reverse', sm: 'row' },
              justifyContent: 'flex-end',
              gap: { xs: 1, sm: 2 },
              '& > .MuiButton-root': { width: { xs: '100%', sm: 'auto' } },
            }}
          >
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
