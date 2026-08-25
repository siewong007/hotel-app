import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { Build as BuildIcon } from '@mui/icons-material';
import { useState, useEffect } from 'react';

import type { Room } from '../../../../types';
import { errorMessage } from '../../../../utils/errorMessage';

interface RoomStatusDialogProps {
  open: boolean;
  room: Room | null;
  onClose: () => void;
  onSubmit: (status: string, notes: string) => Promise<void>;
}

const RoomStatusDialog = ({
  open,
  room,
  onClose,
  onSubmit,
}: RoomStatusDialogProps) => {
  const [status, setStatus] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(room?.status || '');
      setNotes('');
      setError(null);
    }
  }, [open, room]);

  const handleSubmit = async () => {
    if (!status) {
      setError('Please select a status');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit(status, notes);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update room status'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <BuildIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Update Status - {room?.room_number}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={status}
            label="Status"
            onChange={(e) => setStatus(e.target.value)}
            disabled={saving}
          >
            {/* Show current status if it's not one of the manual options, or omit to enforce changing to valid ones */}
            <MenuItem value="available">Available</MenuItem>
            <MenuItem value="dirty">Dirty (Needs Cleaning)</MenuItem>
            <MenuItem value="maintenance">Maintenance / Blocked</MenuItem>
          </Select>
        </FormControl>

        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          label="Notes (Optional)"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Enter reason for status change or maintenance details..."
          disabled={saving}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined" disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving || !status}>
          {saving ? 'Saving...' : 'Update Status'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomStatusDialog;
