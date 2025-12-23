import React, { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
  IconButton
} from '@mui/material';
import {
  QrCodeScanner as QrIcon,
  Close as CloseIcon,
  Add as AddIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';

interface MembershipPointsScannerProps {
  onSuccess?: () => void;
}

const MembershipPointsScanner: React.FC<MembershipPointsScannerProps> = ({ onSuccess }) => {
  const [open, setOpen] = useState(false);
  const [membershipNumber, setMembershipNumber] = useState('');
  const [points, setPoints] = useState<number>(100);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleOpen = () => {
    setOpen(true);
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    setOpen(false);
    setMembershipNumber('');
    setPoints(100);
    setDescription('');
    setError(null);
    setSuccess(null);
  };

  const handleAddPoints = async () => {
    if (!membershipNumber.trim()) {
      setError('Please enter a membership number');
      return;
    }

    if (points <= 0) {
      setError('Points must be greater than 0');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Parse membership number to get membership ID
      // Format expected: MEMBER-{id} or just the numeric ID
      const membershipId = membershipNumber.includes('-')
        ? parseInt(membershipNumber.split('-')[1])
        : parseInt(membershipNumber);

      if (isNaN(membershipId)) {
        setError('Invalid membership number format');
        return;
      }

      // Add points to the membership
      await HotelAPIService.addPointsToMembership(
        membershipId,
        points,
        description || `Points added via scanner`
      );

      setSuccess(`Successfully added ${points} points to membership ${membershipNumber}`);
      
      // Call success callback after a short delay
      setTimeout(() => {
        if (onSuccess) onSuccess();
        handleClose();
      }, 2000);

    } catch (err: any) {
      console.error('Failed to add points:', err);
      setError(err.message || 'Failed to add points. Please check the membership number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        startIcon={<QrIcon />}
        onClick={handleOpen}
        size="large"
      >
        Scan Membership QR
      </Button>

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box display="flex" alignItems="center" gap={1}>
              <QrIcon color="primary" />
              <Typography variant="h6">Add Membership Points</Typography>
            </Box>
            <IconButton onClick={handleClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2 }}>
            <Alert severity="info">
              Enter the membership number from the QR code or membership card to add points.
            </Alert>

            {error && (
              <Alert severity="error" onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            {success && (
              <Alert severity="success">{success}</Alert>
            )}

            <TextField
              fullWidth
              label="Membership Number"
              placeholder="e.g., MEMBER-123 or 123"
              value={membershipNumber}
              onChange={(e) => setMembershipNumber(e.target.value)}
              disabled={loading || !!success}
              autoFocus
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <QrIcon color="action" />
                  </InputAdornment>
                ),
              }}
              helperText="Scan QR code or enter membership number manually"
            />

            <TextField
              fullWidth
              type="number"
              label="Points to Add"
              value={points}
              onChange={(e) => setPoints(parseInt(e.target.value) || 0)}
              disabled={loading || !!success}
              inputProps={{ min: 1, step: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <AddIcon color="action" />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Description (Optional)"
              placeholder="e.g., Purchase reward, Check-in bonus"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading || !!success}
              multiline
              rows={2}
            />

            <Box
              sx={{
                p: 2,
                bgcolor: 'primary.light',
                borderRadius: 1,
                border: '2px dashed',
                borderColor: 'primary.main',
              }}
            >
              <Typography variant="body2" color="primary.dark" gutterBottom sx={{ fontWeight: 600 }}>
                QR Code Scanning Instructions:
              </Typography>
              <Typography variant="caption" color="primary.dark">
                1. Use your device camera to scan the membership QR code
                <br />
                2. The membership number will appear in the field above
                <br />
                3. Adjust points if needed and add a description
                <br />
                4. Click "Add Points" to complete the transaction
              </Typography>
            </Box>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAddPoints}
            disabled={loading || !!success || !membershipNumber}
            startIcon={loading ? <CircularProgress size={20} /> : <AddIcon />}
          >
            {loading ? 'Adding...' : 'Add Points'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default MembershipPointsScanner;
