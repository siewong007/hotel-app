import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import { useState, useEffect } from 'react';

import type { Room } from '../../../../types';

interface RoomNotesDialogProps {
  open: boolean;
  room: Room | null;
  onClose: () => void;
  onSubmit: (notes: string) => Promise<void>;
}

const RoomNotesDialog = ({
  open,
  room,
  onClose,
  onSubmit,
}: RoomNotesDialogProps) => {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNotes(room?.notes || '');
      setError(null);
    }
  }, [open, room]);

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(notes);
      onClose(); // Parent doesn't close on success anymore, dialog owns workflow. Wait, parent handles workflow, but dialog closes itself on success. Actually, parent usually closes. We can leave onClose here.
    } catch (err: any) {
      setError(err.message || 'Failed to save notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <EditIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Room Notes - {room?.room_number}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          sx={{ mt: 2 }}
          placeholder="Enter room notes..."
          disabled={saving}
          inputProps={{ 'data-testid': 'notes-input' }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined" disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomNotesDialog;
