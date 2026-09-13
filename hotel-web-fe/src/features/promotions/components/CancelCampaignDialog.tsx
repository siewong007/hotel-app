import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { Promotion } from "../types";

interface CancelCampaignDialogProps {
  promotion: Promotion | null;
  isCancelling: boolean;
  onClose: () => void;
  onConfirm: (promotion: Promotion, reason?: string) => void;
}

/** Cancellation is terminal, so it gets its own dialog with an optional
 *  operator reason that lands in the campaign's audit event. */
export function CancelCampaignDialog({
  promotion,
  isCancelling,
  onClose,
  onConfirm,
}: CancelCampaignDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (promotion) setReason("");
  }, [promotion]);

  return (
    <Dialog
      open={promotion != null}
      onClose={isCancelling ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Cancel campaign</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Cancel “{promotion?.name}”? This is permanent — the campaign stops
          claiming and its outstanding vouchers can no longer be redeemed.
        </Typography>
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
          fullWidth
          autoFocus
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isCancelling}>
          Keep campaign
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={isCancelling || promotion == null}
          onClick={() => {
            if (!promotion) return;
            const trimmed = reason.trim();
            onConfirm(promotion, trimmed || undefined);
          }}
        >
          {isCancelling ? "Cancelling…" : "Cancel campaign"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
