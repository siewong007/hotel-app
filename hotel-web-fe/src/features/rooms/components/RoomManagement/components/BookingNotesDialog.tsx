import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Alert,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  Notes as NotesIcon,
  AutoAwesome as SparkleIcon,
  Block as BlockIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { BookingWithDetails } from '../../../../../types';
import { useTranslation } from '../../../../../i18n/useTranslation';
import { formatHotelDate } from '../../../../../utils/date';

interface BookingNotesDialogProps {
  open: boolean;
  onClose: () => void;
  booking: BookingWithDetails | null;
  notes: string;
  onNotesChange: (value: string) => void;
  cleaningPreference: boolean | null;
  onCleaningPreferenceChange: (value: boolean | null) => void;
  onSave: () => void;
  saving: boolean;
}

const BookingNotesDialog: React.FC<BookingNotesDialogProps> = ({
  open,
  onClose,
  booking,
  notes,
  onNotesChange,
  cleaningPreference,
  onCleaningPreferenceChange,
  onSave,
  saving,
}) => {
  const { t } = useTranslation('rooms');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'var(--hotel-on-primary)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <NotesIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('bookingNotes.title')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>{t('fields.guest')}:</strong> {booking.guest_name}<br />
                <strong>{t('fields.room')}:</strong> {booking.room_number}<br />
                <strong>{t('fields.stay')}:</strong> {formatHotelDate(booking.check_in_date)} - {formatHotelDate(booking.check_out_date)}
              </Typography>
            </Alert>
            <TextField
              fullWidth
              multiline
              rows={4}
              label={t('fields.notes')}
              placeholder={t('bookingNotes.notesPlaceholder')}
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              variant="outlined"
            />

            {/* Daily cleaning preference */}
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                {t('bookingNotes.cleaningPreference')}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={cleaningPreference === true ? 'daily' : cleaningPreference === false ? 'nodaily' : null}
                onChange={(_, val) => {
                  // Deselecting (val === null) leaves the preference unset locally;
                  // the backend keeps any prior value (COALESCE), it is not cleared.
                  onCleaningPreferenceChange(val === 'daily' ? true : val === 'nodaily' ? false : null);
                }}
                sx={{ flexWrap: 'wrap', gap: 0.75 }}
              >
                <ToggleButton value="daily" sx={{ textTransform: 'none', gap: 0.75, borderRadius: '999px !important', px: 1.75 }}>
                  <SparkleIcon sx={{ fontSize: 16 }} /> {t('card.dailyCleaning')}
                </ToggleButton>
                <ToggleButton value="nodaily" sx={{ textTransform: 'none', gap: 0.75, borderRadius: '999px !important', px: 1.75 }}>
                  <BlockIcon sx={{ fontSize: 16 }} /> {t('card.noDailyCleaning')}
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                {t('bookingNotes.cleaningHint')}
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onClose}
          variant="outlined"
          disabled={saving}
        >
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={onSave}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? t('common:state.saving') : t('bookingNotes.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BookingNotesDialog;
