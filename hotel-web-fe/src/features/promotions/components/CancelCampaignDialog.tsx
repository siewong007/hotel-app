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
import { useTranslation } from "../../../i18n";
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
  const { t } = useTranslation("promotions");
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
      <DialogTitle>{t("cancel.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t("cancel.body", { name: promotion?.name ?? "" })}
        </Typography>
        <TextField
          label={t("cancel.reason")}
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
          {t("cancel.keep")}
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
          {isCancelling ? t("cancel.cancelling") : t("cancel.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
