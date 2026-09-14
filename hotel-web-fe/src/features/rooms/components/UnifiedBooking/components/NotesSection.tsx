import React from 'react';
import { TextField } from '@mui/material';
import { BookingTokens } from '../bookingTokens';
import CollapsibleSection from '../../../../../components/common/CollapsibleSection';

interface NotesSectionProps {
  D: BookingTokens;
  glyph: string;
  bookingNotes: string;
  onNotesChange: (value: string) => void;
}

const NotesSection: React.FC<NotesSectionProps> = ({ D, glyph, bookingNotes, onNotesChange }) => (
  <CollapsibleSection
    title={`${glyph} Notes`}
    subtitle="optional"
    collapseOnPhone
    sx={{ mb: 1 }}
  >
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
  </CollapsibleSection>
);

export default NotesSection;
