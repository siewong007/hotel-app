import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Button,
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';

interface RoomNotesDialogProps {
  open: boolean;
  onClose: () => void;
  roomNumber?: string;
  notes: string;
  onNotesChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

const RoomNotesDialog: React.FC<RoomNotesDialogProps> = ({
  open,
  onClose,
  roomNumber,
  notes,
  onNotesChange,
  onSave,
  saving,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <EditIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Room Notes - {roomNumber}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          label="Notes"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          sx={{ mt: 2 }}
          placeholder="Enter room notes..."
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">Cancel</Button>
        <Button onClick={onSave} variant="contained" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomNotesDialog;
