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
import { useTranslation } from '../../../i18n/useTranslation';
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
  const { t } = useTranslation('guests');
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
      setTransferError(t('portal.emptyUsername'));
      return;
    }

    try {
      setTransferError(null);
      await transferPortalAccountMutation.mutateAsync({ guestId: guest.id, username: trimmed });
      emitApiNotification({
        message: t('portal.transferred', { username: trimmed }),
        severity: 'success',
      });
      onClose();
      await onTransferred();
    } catch (err) {
      setTransferError(errorMessage(err, t('portal.failed')));
    }
  };

  const handleClose = () => {
    if (transferPortalAccountMutation.isPending) return;
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('portal.title')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('portal.warning', { name: guest?.nick_name ?? '' })}
        </Alert>
        {transferError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setTransferError(null)}>
            {transferError}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          label={t('portal.username')}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          helperText={t('portal.helper')}
          disabled={transferPortalAccountMutation.isPending}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={transferPortalAccountMutation.isPending}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={handleTransfer}
          variant="contained"
          disabled={transferPortalAccountMutation.isPending || !username.trim()}
        >
          {transferPortalAccountMutation.isPending ? <CircularProgress size={20} /> : t('portal.transfer')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestPortalAccountDialog;
