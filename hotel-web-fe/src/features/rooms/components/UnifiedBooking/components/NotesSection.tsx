import React from 'react';
import { TextField } from '@mui/material';
import { BookingTokens } from '../bookingTokens';
import CollapsibleSection from '../../../../../components/common/CollapsibleSection';
import { useTranslation } from '../../../../../i18n/useTranslation';

interface NotesSectionProps {
  D: BookingTokens;
  glyph: string;
  bookingNotes: string;
  onNotesChange: (value: string) => void;
}

const NotesSection: React.FC<NotesSectionProps> = ({ D, glyph, bookingNotes, onNotesChange }) => {
  const { t } = useTranslation('rooms');

  return (
  <CollapsibleSection
    title={`${glyph} ${t('common:field.notes')}`}
    subtitle={t('common:field.optional')}
    collapseOnPhone
    sx={{ mb: 1 }}
  >
    <TextField
      fullWidth
      multiline
      minRows={2}
      size="small"
      placeholder={t('unified.notesPlaceholder')}
      value={bookingNotes}
      onChange={(e) => onNotesChange(e.target.value)}
      sx={{ bgcolor: D.surface }}
    />
  </CollapsibleSection>
  );
};

export default NotesSection;
