import React from 'react';
import { Box, Typography } from '@mui/material';
import { BookingTokens } from '../bookingTokens';

interface SectionHeaderProps {
  D: BookingTokens;
  /** The step glyph (e.g. ①) shown before the label. */
  number: string;
  label: React.ReactNode;
}

/** Uppercase section label + trailing rule used throughout the booking form. */
const SectionHeader: React.FC<SectionHeaderProps> = ({ D, number, label }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
    <Typography sx={{ m: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: D.ink3, textTransform: 'uppercase' }}>
      {number} {label}
    </Typography>
    <Box sx={{ flex: 1, height: 1, bgcolor: D.border }} />
  </Box>
);

export default SectionHeader;
