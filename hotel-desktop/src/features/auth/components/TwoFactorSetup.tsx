import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  TextField,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Grid,
  Chip,
  Paper,
  IconButton,
  Divider,
} from '@mui/material';
import {
  Security as SecurityIcon,
  QrCode as QrCodeIcon,
  Refresh as RefreshIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';

interface TwoFactorSetupProps {
  onSetupComplete?: () => void;
}

const TwoFactorSetup: React.FC<TwoFactorSetupProps> = ({ onSetupComplete }) => {
  const [twoFactorStatus, setTwoFactorStatus] = useState<{ enabled: boolean; backup_codes_remaining: number } | null>(null);
  const [setupData, setSetupData] = useState<{
    secret: string;
    qr_code_url: string;
    backup_codes: string[];
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[]>([]);
  const [regenerateCode, setRegenerateCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  useEffect(() => {
    loadTwoFactorStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTwoFactorStatus = async () => {
    try {
      const status = await HotelAPIService.getTwoFactorStatus();
      setTwoFactorStatus(status);
    } catch (error: any) {
      console.error('Failed to load 2FA status:', error);
      showSnackbar('Failed to load 2FA status', 'error');
    }
  };

  const handleSetup2FA = async () => {
    setLoading(true);
    try {
      const data = await HotelAPIService.setupTwoFactor();
      setSetupData(data);
      setShowSetupDialog(true);
    } catch (error: any) {
      console.error('Failed to setup 2FA:', error);
      showSnackbar('Failed to setup 2FA', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEnable2FA = async () => {
    if (!verificationCode.trim()) {
      showSnackbar('Please enter verification code', 'error');
      return;
    }

    setLoading(true);
    try {
      await HotelAPIService.enableTwoFactor(verificationCode);
      setShowSetupDialog(false);
      setVerificationCode('');
      setSetupData(null);
      await loadTwoFactorStatus();
      showSnackbar('2FA enabled successfully', 'success');
      onSetupComplete?.();
    } catch (error: any) {
      console.error('Failed to enable 2FA:', error);
      showSnackbar(error.message || 'Failed to enable 2FA', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!disableCode.trim()) {
      showSnackbar('Please enter your current 2FA code', 'error');
      return;
    }

    setLoading(true);
    try {
      await HotelAPIService.disableTwoFactor(disableCode);
      setShowDisableDialog(false);
      setDisableCode('');
      await loadTwoFactorStatus();
      showSnackbar('2FA disabled successfully', 'success');
      onSetupComplete?.();
    } catch (error: any) {
      console.error('Failed to disable 2FA:', error);
      showSnackbar(error.message || 'Failed to disable 2FA', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateCodes = async () => {
    if (!regenerateCode.trim()) {
      showSnackbar('Please enter your current 2FA code', 'error');
      return;
    }

    setLoading(true);
    try {
      const data = await HotelAPIService.regenerateBackupCodes(regenerateCode);
      setNewBackupCodes(data.backup_codes);
      setShowRegenerateDialog(false);
      setRegenerateCode('');
      await loadTwoFactorStatus();
      showSnackbar('Backup codes regenerated successfully', 'success');
    } catch (error: any) {
      console.error('Failed to regenerate backup codes:', error);
      showSnackbar(error.message || 'Failed to regenerate backup codes', 'error');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showSnackbar('Copied to clipboard', 'success');
    }).catch(() => {
      showSnackbar('Failed to copy to clipboard', 'error');
    });
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  if (!twoFactorStatus) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <Typography>Loading 2FA status...</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                <SecurityIcon />
                Two-Factor Authentication
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add an extra layer of security to your account
              </Typography>
            </Box>
            <Chip
              label={twoFactorStatus.enabled ? 'Enabled' : 'Disabled'}
              color={twoFactorStatus.enabled ? 'success' : 'default'}
              variant={twoFactorStatus.enabled ? 'filled' : 'outlined'}
            />
          </Box>

          <Divider sx={{ mb: 3 }} />

          {!twoFactorStatus.enabled ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <SecurityIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Two-factor authentication is not enabled
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Protect your account with Google Authenticator, Authy, or any TOTP app
              </Typography>
              <Button
                variant="contained"
                onClick={handleSetup2FA}
                disabled={loading}
                startIcon={<QrCodeIcon />}
              >
                {loading ? 'Setting up...' : 'Set Up 2FA'}
              </Button>
            </Box>
          ) : (
            <Box>
              <Alert severity="success" sx={{ mb: 3 }}>
                <Typography variant="body2">
                  <strong>2FA is enabled!</strong> Your account is now protected with two-factor authentication.
                </Typography>
              </Alert>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                      Backup Codes
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {twoFactorStatus.backup_codes_remaining} codes remaining
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<RefreshIcon />}
                      onClick={() => setShowRegenerateDialog(true)}
                    >
                      Generate New Codes
                    </Button>
                  </Paper>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                      Disable 2FA
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Disabling 2FA will make your account less secure
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      color="error"
                      onClick={() => setShowDisableDialog(true)}
                    >
                      Disable 2FA
                    </Button>
                  </Paper>
                </Grid>
              </Grid>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Setup 2FA Dialog */}
      <Dialog open={showSetupDialog} onClose={() => setShowSetupDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Set Up Two-Factor Authentication</DialogTitle>
        <DialogContent>
          {setupData && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body1" sx={{ mb: 2 }}>
                1. Install Google Authenticator, Authy, or any TOTP app on your phone
              </Typography>
              <Typography variant="body1" sx={{ mb: 3 }}>
                2. Scan this QR code with your authenticator app:
              </Typography>

              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                <Box
                  component="img"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupData.qr_code_url)}`}
                  alt="QR Code"
                  sx={{ width: 200, height: 200, border: '1px solid', borderColor: 'divider' }}
                />
              </Box>

              <Typography variant="body1" sx={{ mb: 1 }}>
                Or manually enter this code:
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'grey.100', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', flexGrow: 1 }}>
                    {setupData.secret}
                  </Typography>
                  <IconButton size="small" onClick={() => copyToClipboard(setupData.secret)}>
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Paper>

              <Typography variant="body1" sx={{ mb: 2 }}>
                3. Enter the 6-digit verification code from your authenticator app:
              </Typography>
              <TextField
                fullWidth
                label="Verification Code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputProps={{ maxLength: 6 }}
                sx={{ mb: 3 }}
              />

              <Typography variant="body1" sx={{ mb: 2 }}>
                4. <strong>Important:</strong> Save these backup codes in a secure place. You can use them to access your account if you lose your device:
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'warning.light', mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  ⚠️ Store these codes somewhere safe. Each code can only be used once.
                </Typography>
                <Grid container spacing={1}>
                  {setupData.backup_codes.map((code, index) => (
                    <Grid item xs={6} key={index}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                        {code}
                      </Typography>
                    </Grid>
                  ))}
                </Grid>
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                  <Button
                    size="small"
                    startIcon={<CopyIcon />}
                    onClick={() => copyToClipboard(setupData.backup_codes.join('\n'))}
                  >
                    Copy All Codes
                  </Button>
                </Box>
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSetupDialog(false)}>Cancel</Button>
          <Button
            onClick={handleEnable2FA}
            variant="contained"
            disabled={verificationCode.length !== 6 || loading}
          >
            Enable 2FA
          </Button>
        </DialogActions>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog open={showDisableDialog} onClose={() => setShowDisableDialog(false)}>
        <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Are you sure you want to disable 2FA? This will make your account less secure.
          </Typography>
          <TextField
            fullWidth
            label="Enter your current 2FA code or backup code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            sx={{ mb: 1 }}
          />
          <Typography variant="body2" color="text.secondary">
            This action cannot be undone. Make sure you have access to your authenticator app or backup codes.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDisableDialog(false)}>Cancel</Button>
          <Button
            onClick={handleDisable2FA}
            variant="contained"
            color="error"
            disabled={!disableCode.trim() || loading}
          >
            Disable 2FA
          </Button>
        </DialogActions>
      </Dialog>

      {/* Regenerate Backup Codes Dialog */}
      <Dialog open={showRegenerateDialog} onClose={() => setShowRegenerateDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Regenerate Backup Codes</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Generate new backup codes? Your old codes will no longer work.
          </Typography>
          <TextField
            fullWidth
            label="Enter your current 2FA code"
            value={regenerateCode}
            onChange={(e) => setRegenerateCode(e.target.value)}
            sx={{ mb: 2 }}
          />

          {newBackupCodes.length > 0 && (
            <Paper sx={{ p: 2, bgcolor: 'success.light', mt: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                ✅ Your new backup codes:
              </Typography>
              <Grid container spacing={1}>
                {newBackupCodes.map((code, index) => (
                  <Grid item xs={6} key={index}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 500 }}>
                      {code}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                <Button
                  size="small"
                  startIcon={<CopyIcon />}
                  onClick={() => copyToClipboard(newBackupCodes.join('\n'))}
                >
                  Copy All Codes
                </Button>
              </Box>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRegenerateDialog(false)}>Cancel</Button>
          <Button
            onClick={handleRegenerateCodes}
            variant="contained"
            disabled={!regenerateCode.trim() || loading}
          >
            {newBackupCodes.length > 0 ? 'Close' : 'Generate New Codes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Dialog
        open={snackbar.open}
        onClose={handleCloseSnackbar}
        PaperProps={{
          sx: {
            position: 'fixed',
            bottom: 16,
            left: 16,
            right: 'auto',
            m: 0,
            minWidth: 300,
          }
        }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ mb: 0 }}
        >
          {snackbar.message}
        </Alert>
      </Dialog>
    </Box>
  );
};

export default TwoFactorSetup;
