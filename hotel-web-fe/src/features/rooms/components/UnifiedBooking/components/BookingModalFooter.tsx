import React from 'react';
import { Box, Button, CircularProgress } from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import { BookingTokens } from '../bookingTokens';

interface BookingModalFooterProps {
  D: BookingTokens;
  processing: boolean;
  formIsValid: boolean;
  submitLabel: string;
  onClose: () => void;
  onSubmit: () => void;
}

const BookingModalFooter: React.FC<BookingModalFooterProps> = ({
  D,
  processing,
  formIsValid,
  submitLabel,
  onClose,
  onSubmit,
}) => {
  const kbd = (txt: string) => (
    <Box component="kbd" sx={{ bgcolor: D.surface, border: `1px solid ${D.border}`, px: 0.75, py: '1px', borderRadius: 0.5, fontSize: 10, fontFamily: 'inherit', color: D.ink2 }}>{txt}</Box>
  );

  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.25,
      px: 2.75,
      py: 1.75,
      borderTop: `1px solid ${D.border}`,
      bgcolor: D.surface2,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: D.ink3, fontSize: 12 }}>
        {kbd('Esc')} cancel
        <Box component="span" sx={{ mx: 0.5 }}>·</Box>
        {kbd('⌘ Enter')} create
      </Box>
      <Box sx={{ flex: 1 }} />
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
        Cancel
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
  );
};

export default BookingModalFooter;
