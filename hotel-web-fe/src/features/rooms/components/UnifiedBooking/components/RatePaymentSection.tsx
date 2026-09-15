import React from 'react';
import { Box, Typography, TextField, Checkbox } from '@mui/material';
import { Room } from '../../../../../types';
import { BookingTokens } from '../bookingTokens';
import CollapsibleSection from '../../../../../components/common/CollapsibleSection';
import { toMoneyNumber } from '../../../../../utils/money';
import { useTranslation } from '../../../../../i18n/useTranslation';

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
  /** Hide the read-only "Tourism status" field — when creating a new guest the
   * Tourism Type selector in the guest form already decides this. */
  hideTourismStatus?: boolean;
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
  hideTourismStatus = false,
}) => {
  const { t } = useTranslation('rooms');

  return (
  <CollapsibleSection title={`${glyph} ${t('unified.secRatePayment')}`} collapseOnPhone sx={{ mb: 2.75 }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: hideTourismStatus ? '1fr' : '1fr 1fr', gap: 1.5 }}>
      <Box>
        <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>{t('extendCheckout.ratePerNight')}</Typography>
        <TextField
          type="number"
          size="small"
          fullWidth
          value={useCustomRate ? customRate : defaultRate(room)}
          onChange={(e) => {
            onCustomRateChange(toMoneyNumber(e.target.value));
            onUseCustomRateChange(true);
          }}
          sx={{ bgcolor: D.surface }}
          slotProps={{
            input: { startAdornment: <Box sx={{ color: D.ink3, mr: 1, fontSize: 13 }}>{currencySymbol}</Box> }
          }}
        />
      </Box>
      {!hideTourismStatus && (
        <Box>
          <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>{t('unified.tourismStatus')}</Typography>
          <TextField
            size="small"
            fullWidth
            value={isTourist ? t('unified.tourismForeign', { symbol: currencySymbol, rate: tourismTaxRate }) : t('unified.tourismLocal')}
            disabled
            helperText={t('unified.tourismHelper')}
            sx={{ bgcolor: D.surface }}
          />
        </Box>
      )}
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
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: D.ink }}>{t('unified.useCustomRate')}</Typography>
        <Typography sx={{ fontSize: 11, color: D.ink3, mt: 0.25 }}>
          {t('unified.customRateHint', { rate: formatCurrency(defaultRate(room)) })}
        </Typography>
      </Box>
    </Box>
  </CollapsibleSection>
  );
};

export default RatePaymentSection;
