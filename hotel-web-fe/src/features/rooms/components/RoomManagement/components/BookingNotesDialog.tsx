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
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <NotesIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Edit Booking Notes
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Guest:</strong> {booking.guest_name}<br />
                <strong>Room:</strong> {booking.room_number}<br />
                <strong>Stay:</strong> {new Date(booking.check_in_date).toLocaleDateString()} - {new Date(booking.check_out_date).toLocaleDateString()}
              </Typography>
            </Alert>
            <TextField
              fullWidth
              multiline
              rows={4}
              label="Notes"
              placeholder="Enter booking notes, special requests, or remarks..."
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              variant="outlined"
            />

            {/* Daily cleaning preference */}
            <Box sx={{ mt: 2.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Daily cleaning preference
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
                  <SparkleIcon sx={{ fontSize: 16 }} /> Daily cleaning
                </ToggleButton>
                <ToggleButton value="nodaily" sx={{ textTransform: 'none', gap: 0.75, borderRadius: '999px !important', px: 1.75 }}>
                  <BlockIcon sx={{ fontSize: 16 }} /> No daily cleaning
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                Shown as a chip on the room card while the guest is checked in.
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button
          onClick={onClose}
          variant="outlined"
          disabled={saving}
        >
          Cancel
        </Button>
        <Button
          onClick={onSave}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? 'Saving...' : 'Save Notes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BookingNotesDialog;
