import React from 'react';
import { Box, Typography, TextField } from '@mui/material';
import { BookingTokens } from '../bookingTokens';

interface NotesSectionProps {
  D: BookingTokens;
  glyph: string;
  bookingNotes: string;
  onNotesChange: (value: string) => void;
}

const NotesSection: React.FC<NotesSectionProps> = ({ D, glyph, bookingNotes, onNotesChange }) => (
  <Box sx={{ mb: 1 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
      <Typography sx={{ m: 0, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: D.ink3, textTransform: 'uppercase' }}>
        {glyph} Notes
      </Typography>
      <Typography sx={{ fontSize: 11, color: D.ink3, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
        · optional
      </Typography>
      <Box sx={{ flex: 1, height: 1, bgcolor: D.border }} />
    </Box>
    <TextField
      fullWidth
      multiline
      minRows={2}
      size="small"
      placeholder="Special requests, deposit info, payment notes…"
      value={bookingNotes}
      onChange={(e) => onNotesChange(e.target.value)}
      sx={{ bgcolor: D.surface }}
    />
  </Box>
);

export default NotesSection;
