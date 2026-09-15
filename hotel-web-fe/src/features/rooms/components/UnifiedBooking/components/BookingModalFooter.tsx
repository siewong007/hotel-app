import React from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import { BookingTokens } from '../bookingTokens';
import { useTranslation } from '../../../../../i18n/useTranslation';

interface BookingModalFooterProps {
  D: BookingTokens;
  processing: boolean;
  formIsValid: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => void;
  /** Same computed total that feeds BookingSummaryAside — the aside is hidden
   *  below `md`, so the phone surface for price feedback lives here. */
  total: number;
  billableNights: number;
  formatCurrency: (value: number) => string;
}

const BookingModalFooter: React.FC<BookingModalFooterProps> = ({
  D,
  processing,
  formIsValid,
  submitLabel,
  onClose,
  onSubmit,
  total,
  billableNights,
  formatCurrency,
}) => {
  const { t } = useTranslation('rooms');
  const kbd = (txt: string) => (
    <Box component="kbd" sx={{ bgcolor: D.surface, border: `1px solid ${D.border}`, px: 0.75, py: '1px', borderRadius: 0.5, fontSize: 10, fontFamily: 'inherit', color: D.ink2 }}>{txt}</Box>
  );

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: { xs: 'column', sm: 'row' },
      alignItems: { xs: 'stretch', sm: 'center' },
      gap: 1.25,
      px: { xs: 2, sm: 2.75 },
      py: 1.75,
      borderTop: `1px solid ${D.border}`,
      bgcolor: D.surface2,
    }}>
      {/* Compact total — phones only; the aside carries this on wider
          viewports. Driven by the same `total`/`billableNights` values. */}
      <Box sx={{
        display: { xs: 'flex', sm: 'none' },
        alignItems: 'baseline',
        justifyContent: 'space-between',
        fontSize: 12,
      }}>
        <Box sx={{ color: D.ink3 }}>
          {t('guestSelector.nights', { count: billableNights })}
        </Box>
        <Box sx={{ color: D.ink2, fontWeight: 600 }}>
          {t('common:field.total')}{' '}
          <Box component="span" sx={{ color: D.emerald, fontWeight: 800, fontSize: 15 }}>
            {formatCurrency(total)}
          </Box>
        </Box>
      </Box>
      {/* Keyboard hints — meaningless on touch devices. */}
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1, color: D.ink3, fontSize: 12 }}>
        {kbd('Esc')} {t('unified.kbdCancel')}
        <Box component="span" sx={{ mx: 0.5 }}>·</Box>
        {kbd('⌘ Enter')} {t('unified.kbdCreate')}
      </Box>
      <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
      <Box sx={{ display: 'flex', gap: 1.25, justifyContent: { xs: 'flex-end', sm: 'flex-start' } }}>
        <Button
          onClick={onClose}
          disabled={processing}
          sx={{
            color: D.ink2,
            textTransform: 'none',
            px: 2,
            py: 1,
            borderRadius: 1,
            border: '1px solid transparent',
            '&:hover': { color: D.ink, bgcolor: D.surface3 },
          }}
        >
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={onSubmit}
          disabled={processing || !formIsValid}
          startIcon={processing ? <CircularProgress size={16} sx={{ color: 'inherit' }} /> : <CheckIcon sx={{ fontSize: 14 }} />}
          sx={{
            textTransform: 'none',
            px: 2,
            py: 1.1,
            borderRadius: 1,
            fontWeight: 600,
            boxShadow: 'none',
            '&.Mui-disabled': { background: D.surface3, color: D.ink3, border: `1px solid ${D.border}`, boxShadow: 'none' },
          }}
        >
          {submitLabel}
        </Button>
      </Box>
    </Box>
  );
};

export default BookingModalFooter;
