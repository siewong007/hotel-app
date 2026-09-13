import React from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import type { Guest } from '../../../types';
import { errorMessage } from '../../../utils';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { useTransferGuestPortalAccount } from '../../guests/hooks/useGuestQueries';

interface GuestPortalAccountDialogProps {
  guest: Guest | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful transfer so the page can refetch the list. */
  onTransferred: () => void | Promise<void>;
}

/** Reassigns a guest-portal login to this guest — ported from the monolith's
 * detail-panel action. */
const GuestPortalAccountDialog: React.FC<GuestPortalAccountDialogProps> = ({
  guest,
  open,
  onClose,
  onTransferred,
}) => {
  const transferPortalAccountMutation = useTransferGuestPortalAccount();
  const [username, setUsername] = React.useState('');
  const [transferError, setTransferError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setUsername(guest?.account_username ?? '');
    setTransferError(null);
  }, [open, guest?.account_username]);

  const handleTransfer = async () => {
    if (!guest) return;
    const trimmed = username.trim();
    if (!trimmed) {
      setTransferError('Enter the guest portal username to transfer.');
      return;
    }

    try {
      setTransferError(null);
      await transferPortalAccountMutation.mutateAsync({ guestId: guest.id, username: trimmed });
      emitApiNotification({
        message: `Guest portal account “${trimmed}” transferred successfully`,
        severity: 'success',
      });
      onClose();
      await onTransferred();
    } catch (err) {
      setTransferError(errorMessage(err, 'Failed to transfer guest portal account'));
    }
  };

  const handleClose = () => {
    if (transferPortalAccountMutation.isPending) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Transfer Guest Portal Account</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This reassigns the portal login and its guest-portal access to <strong>{guest?.nick_name}</strong>.
        </Alert>
        {transferError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setTransferError(null)}>
            {transferError}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          label="Guest portal username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          helperText="Only an active guest portal account can be transferred."
          disabled={transferPortalAccountMutation.isPending}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={transferPortalAccountMutation.isPending}>
          Cancel
        </Button>
        <Button
          onClick={handleTransfer}
          variant="contained"
          disabled={transferPortalAccountMutation.isPending || !username.trim()}
        >
          {transferPortalAccountMutation.isPending ? <CircularProgress size={20} /> : 'Transfer account'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestPortalAccountDialog;
