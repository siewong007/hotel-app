import React from 'react';
import { Box, Typography, TextField, FormControlLabel, Checkbox } from '@mui/material';
import { ArrowForward as ArrowForwardIcon, Bedtime as MoonIcon } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { BookingTokens } from '../bookingTokens';
import SectionHeader from './SectionHeader';

interface StaySectionProps {
  D: BookingTokens;
  glyph: string;
  checkInDate: string;
  checkOutDate: string;
  isHourlyBooking: boolean;
  billableNights: number;
  onDateChange: (field: 'checkIn' | 'checkOut', value: string) => void;
  onHourlyToggle: (checked: boolean) => void;
  onQuickSetNights: (nights: number) => void;
  formatHumanDate: (d: string) => string;
}

const QUICK_SETS = [
  { k: '1', label: '1 night', n: 1 },
  { k: '2', label: '2 nights', n: 2 },
  { k: '3', label: '3 nights', n: 3 },
  { k: '7', label: '1 week', n: 7 },
];

const StaySection: React.FC<StaySectionProps> = ({
  D,
  glyph,
  checkInDate,
  checkOutDate,
  isHourlyBooking,
  billableNights,
  onDateChange,
  onHourlyToggle,
  onQuickSetNights,
  formatHumanDate,
}) => (
  <Box sx={{ mb: 2.75 }}>
    <SectionHeader D={D} number={glyph} label="Stay" />
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 1.5, alignItems: 'flex-end' }}>
      <Box>
        <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Check-in</Typography>
        <TextField
          type="date"
          fullWidth
          size="small"
          value={checkInDate}
          onChange={(e) => onDateChange('checkIn', e.target.value)}
          helperText={formatHumanDate(checkInDate)}
          sx={{ bgcolor: D.surface }}
        />
      </Box>
      <Box sx={{ pb: 4, color: D.ink3 }}>
        <ArrowForwardIcon sx={{ fontSize: 18 }} />
      </Box>
      <Box>
        <Typography sx={{ fontSize: 11, color: D.ink3, mb: 0.75, fontWeight: 600 }}>Check-out</Typography>
        <TextField
          type="date"
          fullWidth
          size="small"
          value={checkOutDate}
          onChange={(e) => onDateChange('checkOut', e.target.value)}
          disabled={isHourlyBooking}
          helperText={formatHumanDate(checkOutDate)}
          sx={{ bgcolor: D.surface }}
        />
      </Box>
    </Box>
    <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
      <Box sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        bgcolor: D.emeraldSoft,
        color: D.emerald,
        border: `1px solid ${alpha(D.emerald, 0.3)}`,
        borderRadius: 999,
        px: 1.25,
        py: 0.5,
        fontSize: 11,
        fontWeight: 700,
      }}>
        <MoonIcon sx={{ fontSize: 12 }} />
        {billableNights} {billableNights === 1 ? 'night' : 'nights'}
      </Box>
      <Typography sx={{ color: D.ink3, fontSize: 11 }}>Quick set:</Typography>
      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {QUICK_SETS.map((q) => (
          <Box
            key={q.k}
            component="button"
            onClick={() => onQuickSetNights(q.n)}
            sx={{
              bgcolor: D.surface,
              border: `1px solid ${D.border}`,
              color: D.ink2,
              borderRadius: 999,
              px: 1.25,
              py: 0.5,
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              '&:hover': { borderColor: D.borderHi, color: D.ink },
            }}
          >
            {q.label}
          </Box>
        ))}
      </Box>
      <Box sx={{ ml: 'auto', fontSize: 11, color: D.ink2 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={isHourlyBooking}
              onChange={(e) => onHourlyToggle(e.target.checked)}
              size="small"
              sx={{ p: 0.5 }}
            />
          }
          label={<Box sx={{ fontSize: 11, color: D.ink2 }}>Hourly check-in</Box>}
          sx={{ m: 0 }}
        />
      </Box>
    </Box>
  </Box>
);

export default StaySection;
