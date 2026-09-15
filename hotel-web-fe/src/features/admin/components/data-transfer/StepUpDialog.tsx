import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { useStepUpMutation } from '../../hooks/useDataTransferQueries';
import { useTranslation } from '../../../../i18n';

interface StepUpDialogProps {
  open: boolean;
  /** Context line shown under the title — e.g. which operation needs it. */
  reason?: string;
  onClose: () => void;
  /** Called with the fresh `X-Step-Up` token; the caller immediately runs the
   * gated operation — the token lives ~2 minutes and is session-bound. */
  onVerified: (stepUpToken: string) => void;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Re-authentication dialog for privileged data-transfer operations. Collects
 * the account password plus a TOTP code (required only when the account has
 * 2FA enabled — the server knows, the field stays optional here). The
 * password is held in local state only and cleared on close.
 */
const StepUpDialog: React.FC<StepUpDialogProps> = ({ open, reason, onClose, onVerified }) => {
  const theme = useTheme();
  const { t } = useTranslation('dataTransfer');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stepUp = useStepUpMutation();

  // Clear credentials whenever the dialog closes — nothing sensitive lingers
  // in component state after the token is handed over.
  useEffect(() => {
    if (!open) {
      setPassword('');
      setTotpCode('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      const response = await stepUp.mutateAsync({
        password,
        ...(totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      });
      onVerified(response.stepUpToken);
    } catch (err) {
      setError(errorMessage(err, t('errors:request.verifyCredentials')));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      aria-labelledby="step-up-title"
    >
      <DialogContent sx={{ p: 3 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            color: 'primary.main',
          }}
        >
          <LockIcon />
        </Box>
        <Typography id="step-up-title" sx={{ fontWeight: 800, fontSize: 18, mb: 0.5 }}>
          {t('stepUp.title')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {reason ?? t('stepUp.description')}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (password && !stepUp.isPending) void submit();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label={t('stepUp.password')}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            fullWidth
            size="small"
            autoFocus
          />
          <TextField
            label={t('stepUp.totp')}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            helperText={t('stepUp.totpHint')}
            autoComplete="one-time-code"
            slotProps={{ htmlInput: { inputMode: 'numeric', pattern: '[0-9]*', maxLength: 8 } }}
            fullWidth
            size="small"
          />
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={onClose} color="inherit" fullWidth>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          fullWidth
          disabled={!password || stepUp.isPending}
          startIcon={stepUp.isPending ? <CircularProgress size={18} color="inherit" /> : <LockIcon />}
          onClick={() => void submit()}
          sx={{ fontWeight: 700 }}
        >
          {stepUp.isPending ? t('stepUp.verifying') : t('stepUp.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default StepUpDialog;
