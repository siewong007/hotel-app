import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GuestsService } from '../../../api/guests.service';
import { queryKeys } from '../../../api/queryKeys';
import { queryStaleTime } from '../../../api/queryConfig';
import type { Guest } from '../../../types/guest.types';
import type { Promotion, VoucherIssueInput } from '../types';
import {
  formatPromotionDiscount,
  promotionClaimIssue,
} from '../utils';

const CODE_PATTERN = /^[A-Z0-9]{8,64}$/;

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
  const [promotionId, setPromotionId] = useState<number | ''>('');
  const [guest, setGuest] = useState<Guest | null>(null);
  const [guestSearch, setGuestSearch] = useState('');
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const deferredGuestSearch = useDeferredValue(guestSearch.trim());
  const guestsQuery = useQuery({
    queryKey: queryKeys.guests.page({
      search: deferredGuestSearch || undefined,
      page_size: 10,
    }),
    queryFn: () =>
      GuestsService.getGuestsPage({
        search: deferredGuestSearch || undefined,
        page_size: 10,
      }),
    enabled: open,
    staleTime: queryStaleTime.short,
  });
  const guestOptions = guestsQuery.data?.data ?? [];

  useEffect(() => {
    if (open) {
      setPromotionId('');
      setGuest(null);
      setGuestSearch('');
      setCode('');
      setExpiresAt('');
      setError(null);
    }
  }, [open]);

  const selectedPromotion =
    promotions.find((promotion) => promotion.id === promotionId) ?? null;

  const handleIssue = () => {
    if (!selectedPromotion) {
      setError('Choose an offer to issue the voucher from.');
      return;
    }
    const claimIssue = promotionClaimIssue(selectedPromotion);
    if (claimIssue) {
      setError(claimIssue);
      return;
    }
    if (!guest) {
      setError('Choose a guest to issue the voucher to.');
      return;
    }
    const normalizedCode = code.trim().toUpperCase().replace(/[\s-]/g, '');
    if (normalizedCode && !CODE_PATTERN.test(normalizedCode)) {
      setError('Voucher code must use 8-64 letters or numbers.');
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError('Expiry must be in the future.');
      return;
    }

    setError(null);
    onIssue({
      promotion_id: selectedPromotion.id,
      guest_id: guest.id,
      code: normalizedCode || undefined,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
  };

  return (
    <Dialog open={open} onClose={isSaving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Issue voucher</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <FormControl fullWidth required>
            <InputLabel id="voucher-offer-label">Offer</InputLabel>
            <Select
              labelId="voucher-offer-label"
              label="Offer"
              value={promotionId}
              onChange={(event) =>
                setPromotionId(event.target.value as number | '')
              }
            >
              {promotions.map((promotion) => {
                const claimIssue = promotionClaimIssue(promotion);
                const remaining =
                  promotion.claim_limit != null
                    ? promotion.claim_limit - promotion.claimed_count
                    : null;
                return (
                  <MenuItem
                    key={promotion.id}
                    value={promotion.id}
                    disabled={claimIssue != null}
                  >
                    <Box>
                      <Typography variant="body2">{promotion.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatPromotionDiscount(promotion)}
                        {claimIssue
                          ? ` — ${claimIssue}`
                          : remaining != null
                            ? ` — ${remaining} left`
                            : ''}
                      </Typography>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
            <FormHelperText>
              Only published offers inside their claim window can issue
              vouchers.
            </FormHelperText>
          </FormControl>
          <Autocomplete
            value={guest}
            options={guestOptions}
            loading={guestsQuery.isFetching}
            getOptionLabel={(option) => option.nick_name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            filterOptions={(options) => options}
            onChange={(_event, value) => setGuest(value)}
            onInputChange={(_event, value) => setGuestSearch(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Guest"
                helperText="Each guest can hold one voucher per offer."
              />
            )}
            renderOption={(props, option) => (
              <Box component="li" {...props} key={option.id}>
                <Box>
                  <Typography variant="body2">{option.nick_name}</Typography>
                  {option.email ? (
                    <Typography variant="caption" color="text.secondary">
                      {option.email}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            )}
          />
          <TextField
            label="Custom voucher code"
            helperText="Optional — leave blank to generate a secure code."
            value={code}
            onChange={(event) => setCode(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 64 } }}
            fullWidth
          />
          <TextField
            label="Expires at"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Optional — the voucher stays usable until this time."
            fullWidth
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
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
