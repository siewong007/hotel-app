import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';

import { useTranslation } from '../../../i18n/useTranslation';
import type { BulkRoomRateInput, RatePlan, RoomTypeRef } from '../types';
import ModernDatePicker from '../../../components/common/ModernDatePicker';

export interface BulkRateDialogProps {
  open: boolean;
  plans: RatePlan[];
  roomTypes: RoomTypeRef[];
  saving: boolean;
  onClose(): void;
  onSubmit(input: BulkRoomRateInput): void;
}

/**
 * Writes one rate band per selected room type under the chosen plan,
 * covering [effective_from, effective_to]. Exact-bounds bands are repriced
 * in place; new bounds insert new bands.
 */
export const BulkRateDialog = ({
  open,
  plans,
  roomTypes,
  saving,
  onClose,
  onSubmit,
}: BulkRateDialogProps) => {
  const { t } = useTranslation('rates');
  const [planId, setPlanId] = useState('');
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [price, setPrice] = useState('');

  const toggleType = (id: number) =>
    setTypeIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  const rangeError =
    from !== '' && to !== '' && from > to
      ? t('bulk.rangeError')
      : null;

  const valid =
    planId !== '' &&
    typeIds.length > 0 &&
    from !== '' &&
    to !== '' &&
    !rangeError &&
    Number.parseFloat(price) > 0;

  const submit = () => {
    if (!valid) return;
    onSubmit({
      rate_plan_id: Number(planId),
      room_type_ids: typeIds,
      effective_from: from,
      effective_to: to,
      price: Number.parseFloat(price),
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('bulk.title')}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <TextField
            select
            label={t('bulk.ratePlan')}
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            required
            fullWidth
          >
            {plans.map((plan) => (
              <MenuItem key={plan.id} value={String(plan.id)}>
                {plan.name} ({plan.code})
              </MenuItem>
            ))}
          </TextField>
          <Box>
            <FormLabel component="legend">{t('bulk.roomTypes')}</FormLabel>
            <FormGroup row>
              {roomTypes.map((type) => (
                <FormControlLabel
                  key={type.id}
                  control={
                    <Checkbox
                      size="small"
                      checked={typeIds.includes(type.id)}
                      onChange={() => toggleType(type.id)}
                    />
                  }
                  label={type.name}
                />
              ))}
            </FormGroup>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <ModernDatePicker
              label={t('bulk.effectiveFrom')}
              value={from}
              onChange={setFrom}
              required
            />
            <ModernDatePicker
              label={t('bulk.effectiveTo')}
              value={to}
              onChange={setTo}
              required
              error={Boolean(rangeError)}
              helperText={rangeError ?? undefined}
            />
          </Box>
          <TextField
            label={t('bulk.price')}
            type="number"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            required
            fullWidth
            slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
          />
          <Typography variant="caption" color="text.secondary">
            {t('bulk.hint')}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={submit} disabled={!valid || saving}>
          {t('bulk.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
