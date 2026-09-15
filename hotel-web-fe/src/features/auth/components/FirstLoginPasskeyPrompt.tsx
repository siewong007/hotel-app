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
import { errorMessage } from '../../../utils/errorMessage';
import { useAutoFocusError } from '../../../hooks/useAutoFocusError';
import { useTranslation } from '../../../i18n';

interface FirstLoginPasskeyPromptProps {
  open: boolean;
  username: string;
  onClose: () => void;
}

const FirstLoginPasskeyPrompt: React.FC<FirstLoginPasskeyPromptProps> = ({ open, username, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useAutoFocusError(error);
  const { registerPasskey } = useAuth();
  const { t } = useTranslation('auth');

  const handleRegisterPasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      await registerPasskey(username);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('passkeys.registerFailed')));
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
            {t('passkeys.firstLoginTitle')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body1" gutterBottom sx={{ mb: 2 }}>
          {t('passkeys.firstLoginWelcome')}
        </Typography>
        <Typography variant="body1" gutterBottom sx={{ mb: 2 }}>
          {t('passkeys.firstLoginIntro')}
        </Typography>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
          <li>
            <Typography variant="body2">{t('passkeys.benefitSecure')}</Typography>
          </li>
          <li>
            <Typography variant="body2">{t('passkeys.benefitFast')}</Typography>
          </li>
          <li>
            <Typography variant="body2">{t('passkeys.benefitBiometric')}</Typography>
          </li>
          <li>
            <Typography variant="body2">{t('passkeys.benefitPhishing')}</Typography>
          </li>
        </Box>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mb: 2
          }}>
          {t('passkeys.firstLoginLimit')}
        </Typography>
        {error && (
          <Alert severity="error" role="alert" ref={errorRef} tabIndex={-1} sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          {t('passkeys.firstLoginSkip')}
        </Button>
        <Button
          variant="contained"
          onClick={handleRegisterPasskey}
          disabled={loading}
          startIcon={<FingerprintIcon />}
        >
          {loading ? t('passkeys.registering') : t('passkeys.register')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FirstLoginPasskeyPrompt;
