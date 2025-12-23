import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
} from '@mui/material';
import { Fingerprint as FingerprintIcon } from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';

interface FirstLoginPasskeyPromptProps {
  open: boolean;
  username: string;
  onClose: () => void;
}

const FirstLoginPasskeyPrompt: React.FC<FirstLoginPasskeyPromptProps> = ({ open, username, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { registerPasskey } = useAuth();

  const handleRegisterPasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      await registerPasskey(username);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to register passkey');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <FingerprintIcon sx={{ fontSize: 40, color: 'primary.main' }} />
          <Typography variant="h5" component="span" sx={{ fontWeight: 600 }}>
            Secure Your Account with a Passkey
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body1" gutterBottom sx={{ mb: 2 }}>
          Welcome! It looks like this is your first time logging in.
        </Typography>
        <Typography variant="body1" gutterBottom sx={{ mb: 2 }}>
          We recommend setting up a passkey for secure, passwordless authentication. Passkeys are:
        </Typography>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
          <li>
            <Typography variant="body2">More secure than passwords</Typography>
          </li>
          <li>
            <Typography variant="body2">Faster and easier to use</Typography>
          </li>
          <li>
            <Typography variant="body2">Protected by your device's biometrics or PIN</Typography>
          </li>
          <li>
            <Typography variant="body2">Resistant to phishing attacks</Typography>
          </li>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You can add up to 10 passkeys to your account and manage them in your profile settings.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Skip for Now
        </Button>
        <Button
          variant="contained"
          onClick={handleRegisterPasskey}
          disabled={loading}
          startIcon={<FingerprintIcon />}
        >
          {loading ? 'Registering...' : 'Register Passkey'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FirstLoginPasskeyPrompt;
