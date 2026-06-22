import React from 'react';
import { Box, Typography, TextField, Checkbox } from '@mui/material';
import { Room } from '../../../../../types';
import { BookingTokens } from '../bookingTokens';
import SectionHeader from './SectionHeader';
import { toMoneyNumber } from '../../../../../utils/money';

interface RatePaymentSectionProps {
  D: BookingTokens;
  glyph: string;
  room: Room | null;
  useCustomRate: boolean;
  onUseCustomRateChange: (checked: boolean) => void;
  customRate: number;
  onCustomRateChange: (value: number) => void;
  isTourist: boolean;
  tourismTaxRate: number;
  currencySymbol: string;
  formatCurrency: (value: number) => string;
}

const defaultRate = (room: Room | null): number =>
  toMoneyNumber(room?.price_per_night);

const RatePaymentSection: React.FC<RatePaymentSectionProps> = ({
  D,
  glyph,
  room,
  useCustomRate,
  onUseCustomRateChange,
  customRate,
  onCustomRateChange,
  isTourist,
  tourismTaxRate,
  currencySymbol,
  formatCurrency,
}) => (
  <Box sx={{ mb: 2.75 }}>
    <SectionHeader D={D} number={glyph} label="Rate & payment" />
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
      <Box>
        <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Rate per night</Typography>
        <TextField
          type="number"
          size="small"
          fullWidth
          value={useCustomRate ? customRate : defaultRate(room)}
          onChange={(e) => {
            onCustomRateChange(toMoneyNumber(e.target.value));
            onUseCustomRateChange(true);
          }}
          InputProps={{ startAdornment: <Box sx={{ color: D.ink3, mr: 1, fontSize: 13 }}>{currencySymbol}</Box> }}
          sx={{ bgcolor: D.surface }}
        />
      </Box>
      <Box>
        <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Tourism status</Typography>
        <TextField
          size="small"
          fullWidth
          value={isTourist ? `Foreign guest (${currencySymbol} ${tourismTaxRate}/night)` : 'Local — no tourism tax'}
          disabled
          helperText="Set on the guest profile"
          sx={{ bgcolor: D.surface }}
        />
      </Box>
    </Box>
    <Box
      component="label"
      sx={{
        mt: 1.25,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
        p: 1.5,
        border: `1px solid ${useCustomRate ? D.emerald : D.border}`,
        borderRadius: 1.25,
        bgcolor: useCustomRate ? D.emeraldSoft : D.surface,
        cursor: 'pointer',
      }}
    >
      <Checkbox
        checked={useCustomRate}
        onChange={(e) => onUseCustomRateChange(e.target.checked)}
        size="small"
        sx={{ p: 0, mt: 0.25 }}
      />
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: D.ink }}>Use custom rate</Typography>
        <Typography sx={{ fontSize: 11, color: D.ink3, mt: 0.25 }}>
          Override the default rate of {formatCurrency(defaultRate(room))} / night
        </Typography>
      </Box>
    </Box>
  </Box>
);

export default RatePaymentSection;
