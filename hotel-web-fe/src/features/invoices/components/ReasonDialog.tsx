import React, { useState } from 'react';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from '../../../i18n';
import { isValidStaffReason, MIN_STAFF_REASON_LENGTH } from '../utils/payments';

export interface ReasonDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText: string;
  /** Destructive voids use `error`; reversible corrections `warning`. */
  severity?: 'error' | 'warning';
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/**
 * Confirm dialog that will not submit without a staff reason — used for
 * voiding a payment, reverting a deposit refund and restoring a cancelled
 * deposit, where the backend rejects a request without one. The reason is
 * trimmed and must reach `MIN_STAFF_REASON_LENGTH` characters.
 */
const ReasonDialog: React.FC<ReasonDialogProps> = ({
  open,
  title,
  message,
  confirmText,
  severity = 'warning',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation('finance');
  const [reason, setReason] = useState('');
  const valid = isValidStaffReason(reason);
  const showTooShort = reason.length > 0 && !valid;

  const close = () => {
    if (busy) return;
    setReason('');
    onCancel();
  };

  const submit = () => {
    if (!valid || busy) return;
    const trimmed = reason.trim();
    setReason('');
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth aria-labelledby="reason-dialog-title">
      <DialogTitle id="reason-dialog-title">{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {message}
        </Typography>
        <TextField
          autoFocus
          required
          fullWidth
          multiline
          minRows={2}
          size="small"
          label={t('reason.label')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={showTooShort}
          helperText={showTooShort
            ? t('reason.tooShort', { min: MIN_STAFF_REASON_LENGTH })
            : t('reason.helper')}
          slotProps={{ htmlInput: { maxLength: 500, 'data-testid': 'reason-dialog-input' } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          color={severity}
          onClick={submit}
          disabled={!valid || busy}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ReasonDialog;
