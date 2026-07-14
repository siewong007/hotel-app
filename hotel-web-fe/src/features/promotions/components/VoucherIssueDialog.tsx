import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { Promotion, VoucherIssueInput } from '../types';

interface VoucherIssueDialogProps {
  open: boolean;
  promotions: Promotion[];
  isSaving: boolean;
  onClose: () => void;
  onIssue: (input: VoucherIssueInput) => void;
}

export function VoucherIssueDialog({
  open,
  promotions,
  isSaving,
  onClose,
  onIssue,
}: VoucherIssueDialogProps) {
  const [promotionId, setPromotionId] = useState('');
  const [guestId, setGuestId] = useState('');
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPromotionId('');
      setGuestId('');
      setCode('');
      setExpiresAt('');
      setError(null);
    }
  }, [open]);

  const handleIssue = () => {
    const selectedPromotionId = Number(promotionId);
    const selectedGuestId = Number(guestId);
    if (!Number.isInteger(selectedPromotionId) || !Number.isInteger(selectedGuestId)) {
      setError('Choose a promotion and enter a valid guest ID.');
      return;
    }

    onIssue({
      promotion_id: selectedPromotionId,
      guest_id: selectedGuestId,
      code: code.trim() || undefined,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  };

  return (
    <Dialog open={open} onClose={isSaving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Issue voucher</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <FormControl fullWidth>
            <InputLabel id="voucher-promotion-label">Promotion</InputLabel>
            <Select
              labelId="voucher-promotion-label"
              label="Promotion"
              value={promotionId}
              onChange={(event) => setPromotionId(event.target.value)}
            >
              {promotions.map((promotion) => (
                <MenuItem key={promotion.id} value={String(promotion.id)}>
                  {promotion.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Guest ID"
            type="number"
            value={guestId}
            onChange={(event) => setGuestId(event.target.value)}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
            required
            fullWidth
          />
          <TextField
            label="Custom voucher code"
            helperText="Optional; leave blank to generate a secure code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            fullWidth
          />
          <TextField
            label="Expires at"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          {error ? <Typography color="error">{error}</Typography> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleIssue} disabled={isSaving}>
          {isSaving ? 'Issuing…' : 'Issue voucher'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
