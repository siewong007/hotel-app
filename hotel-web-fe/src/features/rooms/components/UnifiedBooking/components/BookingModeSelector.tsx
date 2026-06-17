import React from 'react';
import { Box, Typography } from '@mui/material';
import { PersonAdd as PersonAddIcon, EventAvailable as BookingIcon } from '@mui/icons-material';
import { BookingTokens } from '../bookingTokens';
import { BookingMode } from '../bookingTypes';
import SectionHeader from './SectionHeader';

interface BookingModeSelectorProps {
  D: BookingTokens;
  glyph: string;
  bookingMode: BookingMode | null;
  onSelect: (mode: BookingMode) => void;
}

const MODE_OPTIONS: Array<{ k: BookingMode; label: string; desc: string; icon: React.ReactNode }> = [
  { k: 'direct',      label: 'Direct booking', desc: 'Check guest in immediately', icon: <PersonAddIcon sx={{ fontSize: 16 }} /> },
  { k: 'reservation', label: 'Reservation',    desc: 'Reserve for a future date', icon: <BookingIcon sx={{ fontSize: 16 }} /> },
];

/** Segmented control choosing between direct booking and a reservation. */
const BookingModeSelector: React.FC<BookingModeSelectorProps> = ({ D, glyph, bookingMode, onSelect }) => (
  <Box sx={{ mb: 2.75 }}>
    <SectionHeader D={D} number={glyph} label="Mode" />
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 1,
      bgcolor: D.surface2,
      border: `1px solid ${D.border}`,
      borderRadius: 1.5,
      p: '5px',
    }}>
      {MODE_OPTIONS.map((m) => {
        const on = bookingMode === m.k;
        return (
          <Box
            key={m.k}
            component="button"
            onClick={() => onSelect(m.k)}
            sx={{
              bgcolor: on ? D.surface : 'transparent',
              border: on ? `1px solid ${D.emerald}` : '1px solid transparent',
              borderRadius: 1,
              px: 1.5,
              py: 1.25,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: on ? D.ink : D.ink2,
              boxShadow: on ? `0 0 0 1px ${D.emerald} inset, 0 1px 3px rgba(15,23,42,0.06)` : 'none',
            }}
          >
            <Box sx={{
              width: 32,
              height: 32,
              borderRadius: 1,
              bgcolor: on ? D.emeraldSoft : D.surface3,
              color: on ? D.emerald : D.ink2,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}>
              {m.icon}
            </Box>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600, color: D.ink, lineHeight: 1.2 }}>{m.label}</Typography>
              <Typography sx={{ fontSize: 11, color: D.ink3, mt: '1px' }}>{m.desc}</Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  </Box>
);

export default BookingModeSelector;
