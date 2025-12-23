import React, { useState } from 'react';
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
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate account');
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
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate account');
    } finally {
      setLoading(false);
    }
  };

  if (isDeactivated) {
    return (
      <Card sx={{ borderLeft: '4px solid', borderColor: 'warning.main' }}>
        <CardContent>
          <Box display="flex" alignItems="center" mb={2}>
            <WarningIcon sx={{ color: 'warning.main', mr: 1, fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Account Deactivated
            </Typography>
          </Box>

          <Alert severity="warning" sx={{ mb: 2 }}>
            Your account is currently deactivated. You won't be able to make new bookings or access certain features.
          </Alert>

          <Typography variant="body2" color="text.secondary" paragraph>
            You can reactivate your account at any time to restore full access.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
              Account reactivated successfully!
            </Alert>
          )}

          <Button
            variant="contained"
            color="success"
            onClick={handleReactivate}
            disabled={loading}
          >
            {loading ? 'Reactivating...' : 'Reactivate Account'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card sx={{ borderLeft: '4px solid', borderColor: 'error.main' }}>
        <CardContent>
          <Box display="flex" alignItems="center" mb={2}>
            <WarningIcon sx={{ color: 'error.main', mr: 1, fontSize: 28 }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Deactivate Account
            </Typography>
          </Box>

          <Typography variant="body2" color="text.secondary" paragraph>
            Deactivating your account will:
          </Typography>

          <Box component="ul" sx={{ pl: 2, mb: 2 }}>
            <Typography component="li" variant="body2" color="text.secondary">
              Mark your account as inactive
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary">
              Prevent new bookings
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary">
              Preserve your booking history
            </Typography>
            <Typography component="li" variant="body2" color="text.secondary">
              Allow you to reactivate anytime
            </Typography>
          </Box>

          <Alert severity="info" sx={{ mb: 2 }}>
            <strong>Note:</strong> Your data will be preserved and you can reactivate your account at any time.
          </Alert>

          <Button
            variant="outlined"
            color="error"
            onClick={() => setDialogOpen(true)}
            startIcon={<WarningIcon />}
          >
            Deactivate Account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center">
            <WarningIcon sx={{ color: 'error.main', mr: 1 }} />
            Confirm Account Deactivation
          </Box>
        </DialogTitle>

        <DialogContent>
          <Alert severity="warning" sx={{ mb: 3 }}>
            Are you sure you want to deactivate your account? You can reactivate it anytime.
          </Alert>

          <Typography variant="body2" color="text.secondary" paragraph>
            Optionally, let us know why you're deactivating your account:
          </Typography>

          <TextField
            fullWidth
            multiline
            rows={4}
            label="Reason (Optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Tell us why you're leaving..."
            sx={{ mb: 2 }}
          />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
              Account deactivated successfully!
            </Alert>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleDeactivate}
            color="error"
            variant="contained"
            disabled={loading || success}
          >
            {loading ? 'Deactivating...' : 'Deactivate Account'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default AccountDeactivation;
