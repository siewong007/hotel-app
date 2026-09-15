import React, { useState } from 'react';
import { errorMessage } from '../../../utils/errorMessage';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Divider,
} from '@mui/material';
import {
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { useTranslation } from '../../../i18n';

interface AccountDeactivationProps {
  onDeactivate: (reason?: string) => Promise<void>;
  isDeactivated?: boolean;
  onReactivate?: () => Promise<void>;
}

const AccountDeactivation: React.FC<AccountDeactivationProps> = ({
  onDeactivate,
  isDeactivated = false,
  onReactivate,
}) => {
  const { t } = useTranslation('auth');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleDeactivate = async () => {
    try {
      setLoading(true);
      setError(null);
      await onDeactivate(reason || undefined);
      setSuccess(true);
      setTimeout(() => {
        setDialogOpen(false);
        setSuccess(false);
        setReason('');
      }, 2000);
    } catch (err) {
      setError(errorMessage(err, t('deactivation.failed')));
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!onReactivate) return;

    try {
      setLoading(true);
      setError(null);
      await onReactivate();
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
      }, 2000);
    } catch (err) {
      setError(errorMessage(err, t('deactivation.reactivateFailed')));
    } finally {
      setLoading(false);
    }
  };

  if (isDeactivated) {
    return (
      <Card sx={{ borderLeft: '4px solid', borderColor: 'warning.main' }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              mb: 2
            }}>
            <WarningIcon sx={{ color: 'warning.main', mr: 1, fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t('deactivation.deactivatedTitle')}
            </Typography>
          </Box>

          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('deactivation.deactivatedAlert')}
          </Alert>

          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              marginBottom: "16px"
            }}>
            {t('deactivation.reactivateHint')}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
              {t('deactivation.reactivated')}
            </Alert>
          )}

          <Button
            variant="contained"
            color="success"
            onClick={handleReactivate}
            disabled={loading}
          >
            {loading ? t('deactivation.reactivating') : t('deactivation.reactivate')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card sx={{ borderLeft: '4px solid', borderColor: 'error.main' }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              mb: 2
            }}>
            <WarningIcon sx={{ color: 'error.main', mr: 1, fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t('deactivation.title')}
            </Typography>
          </Box>

          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              marginBottom: "16px"
            }}>
            {t('deactivation.effectsIntro')}
          </Typography>

          <Box component="ul" sx={{ pl: 2, mb: 2 }}>
            <Typography component="li" variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('deactivation.effectInactive')}
            </Typography>
            <Typography component="li" variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('deactivation.effectBookings')}
            </Typography>
            <Typography component="li" variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('deactivation.effectHistory')}
            </Typography>
            <Typography component="li" variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('deactivation.effectReactivate')}
            </Typography>
          </Box>

          <Alert severity="info" sx={{ mb: 2 }}>
            <strong>{t('deactivation.noteLabel')}</strong> {t('deactivation.noteBody')}
          </Alert>

          <Button
            variant="outlined"
            color="error"
            onClick={() => setDialogOpen(true)}
            startIcon={<WarningIcon />}
          >
            {t('deactivation.title')}
          </Button>
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box
            sx={{
              display: "flex",
              alignItems: "center"
            }}>
            <WarningIcon sx={{ color: 'error.main', mr: 1 }} />
            {t('deactivation.confirmTitle')}
          </Box>
        </DialogTitle>

        <DialogContent>
          <Alert severity="warning" sx={{ mb: 3 }}>
            {t('deactivation.confirmMessage')}
          </Alert>

          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              marginBottom: "16px"
            }}>
            {t('deactivation.reasonPrompt')}
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={4}
            label={t('deactivation.reasonLabel')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('deactivation.reasonPlaceholder')}
            sx={{ mb: 2 }}
          />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
              {t('deactivation.deactivated')}
            </Alert>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={loading}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={handleDeactivate}
            color="error"
            variant="contained"
            disabled={loading || success}
          >
            {loading ? t('deactivation.deactivating') : t('deactivation.title')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default AccountDeactivation;
