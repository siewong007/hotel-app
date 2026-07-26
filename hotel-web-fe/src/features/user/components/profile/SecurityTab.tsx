import React, { useState } from 'react';
import { Box, Button, Card, CardContent, Grid, TextField, Typography } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { ApiNotificationSeverity } from '../../../../utils/apiNotifications';

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
  const [passwordData, setPasswordData] = useState(EMPTY_FORM);
  const [showNewPasswordFields, setShowNewPasswordFields] = useState(false);

  const reset = () => {
    setPasswordData(EMPTY_FORM);
    setShowNewPasswordFields(false);
  };

  const handleCurrentPasswordSubmit = () => {
    if (!passwordData.current_password) {
      notify('Please enter your current password', 'warning');
      return;
    }
    if (passwordData.current_password.length < 3) {
      notify('Please enter a valid password', 'warning');
      return;
    }
    setShowNewPasswordFields(true);
  };

  const handleSubmit = async () => {
    if (!passwordData.current_password || !passwordData.new_password) {
      notify('Please fill in all password fields', 'warning');
      return;
    }
    if (passwordData.new_password !== passwordData.confirm_password) {
      notify('New passwords do not match', 'warning');
      return;
    }
    if (passwordData.new_password.length < MIN_PASSWORD_LENGTH) {
      notify(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`, 'warning');
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
          Change Password
        </Typography>
        <Grid container spacing={3}>
          <Grid size={12}>
            <TextField
              fullWidth
              type="password"
              label="Current Password"
              value={passwordData.current_password}
              onChange={e =>
                setPasswordData({ ...passwordData, current_password: e.target.value })
              }
              disabled={showNewPasswordFields}
              helperText={
                !showNewPasswordFields ? 'Enter your current password to continue' : ''
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
                  Continue
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
                  label="New Password"
                  value={passwordData.new_password}
                  onChange={e =>
                    setPasswordData({ ...passwordData, new_password: e.target.value })
                  }
                  helperText={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth
                  type="password"
                  label="Confirm New Password"
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
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<LockIcon />}
              onClick={handleSubmit}
              disabled={!passwordData.new_password || !passwordData.confirm_password}
            >
              Update Password
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};

export default SecurityTab;
