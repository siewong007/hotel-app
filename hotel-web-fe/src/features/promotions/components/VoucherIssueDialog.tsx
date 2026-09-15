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
import { useTranslation } from '../../../i18n';
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
  /** Server-side failure from the last attempt (e.g. guest already holds a
   *  voucher for this offer). */
  errorMessage?: string | null;
  onClose: () => void;
  onIssue: (input: VoucherIssueInput) => void;
}

export function VoucherIssueDialog({
  open,
  promotions,
  isSaving,
  errorMessage,
  onClose,
  onIssue,
}: VoucherIssueDialogProps) {
  const { t } = useTranslation('promotions');
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
      setError(t('issue.errors.chooseOffer'));
      return;
    }
    const claimIssue = promotionClaimIssue(selectedPromotion, t);
    if (claimIssue) {
      setError(claimIssue);
      return;
    }
    if (!guest) {
      setError(t('issue.errors.chooseGuest'));
      return;
    }
    const normalizedCode = code.trim().toUpperCase().replace(/[\s-]/g, '');
    if (normalizedCode && !CODE_PATTERN.test(normalizedCode)) {
      setError(t('issue.errors.codePattern'));
      return;
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      setError(t('issue.errors.expiryFuture'));
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
      <DialogTitle>{t('issue.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <FormControl fullWidth required>
            <InputLabel id="voucher-offer-label">{t('issue.offerLabel')}</InputLabel>
            <Select
              labelId="voucher-offer-label"
              label={t('issue.offerLabel')}
              value={promotionId}
              onChange={(event) =>
                setPromotionId(event.target.value as number | '')
              }
            >
              {promotions.map((promotion) => {
                const claimIssue = promotionClaimIssue(promotion, t);
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
                        {formatPromotionDiscount(promotion, t)}
                        {claimIssue
                          ? ` — ${claimIssue}`
                          : remaining != null
                            ? ` — ${t('issue.remainingLeft', { count: remaining })}`
                            : ''}
                      </Typography>
                    </Box>
                  </MenuItem>
                );
              })}
            </Select>
            <FormHelperText>
              {t('issue.offerHelp')}
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
                label={t('issue.guestLabel')}
                helperText={t('issue.guestHelp')}
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
            label={t('issue.codeLabel')}
            helperText={t('issue.codeHelp')}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 64 } }}
            fullWidth
          />
          <TextField
            label={t('issue.expiresLabel')}
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={t('issue.expiresHelp')}
            fullWidth
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
          {errorMessage ? (
            <Alert severity="error">{errorMessage}</Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSaving}>
          {t('common:actions.cancel')}
        </Button>
        <Button variant="contained" onClick={handleIssue} disabled={isSaving}>
          {isSaving ? t('issue.issuing') : t('issue.title')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
