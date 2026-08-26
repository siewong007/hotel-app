import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import {
  ErrorOutlineOutlined as ErrorIcon,
  InfoOutlined as InfoIcon,
  WarningAmberOutlined as WarningIcon,
} from '@mui/icons-material';

/**
 * Drives the icon, the accent colour, and the confirm button colour. `error` is
 * the right pick for anything destructive (deleting a payment, revoking a
 * voucher); `warning` for reversible-but-lossy actions (discarding edits);
 * `info` for a plain "are you sure".
 */
export type ConfirmSeverity = 'error' | 'warning' | 'info';

export interface ConfirmOptions {
  /** Heading. Defaults to a phrase matching the severity. */
  title?: string;
  /** Body text. Accepts nodes so callers can bold a record name. */
  message: ReactNode;
  /** Confirm button label. Defaults to "Confirm". */
  confirmText?: string;
  /** Cancel button label. Defaults to "Cancel". */
  cancelText?: string;
  severity?: ConfirmSeverity;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const SEVERITY_ICON = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
} as const;

const DEFAULT_TITLE = {
  error: 'Are you sure?',
  warning: 'Please confirm',
  info: 'Please confirm',
} as const;

/**
 * The app's replacement for `window.confirm`. Rendered by `ConfirmProvider` —
 * reach for `useConfirm()` rather than mounting this directly, unless a screen
 * needs to own the open state itself.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  severity = 'warning',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const Icon = SEVERITY_ICON[severity];
  const confirmColor = severity === 'info' ? 'primary' : severity;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
    >
      <DialogTitle id="confirm-dialog-title" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              borderRadius: '50%',
              flexShrink: 0,
              color: `${severity}.main`,
              bgcolor: `${severity}.light`,
              opacity: 0.95,
            }}
          >
            <Icon fontSize="small" />
          </Box>
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {title ?? DEFAULT_TITLE[severity]}
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pb: 1 }}>
        <Typography
          id="confirm-dialog-message"
          variant="body2"
          color="text.secondary"
          component="div"
          sx={{ pl: { xs: 0, sm: 7 } }}
        >
          {message}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
        <Button onClick={onCancel} color="inherit">
          {cancelText}
        </Button>
        <Button onClick={onConfirm} variant="contained" color={confirmColor} autoFocus>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
