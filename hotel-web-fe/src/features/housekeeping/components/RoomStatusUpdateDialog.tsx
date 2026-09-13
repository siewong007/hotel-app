import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import StatusChip from '../../../components/common/StatusChip';
import { errorMessage } from '../../../utils/errorMessage';
import { formatStatusLabel } from '../../../utils/formatters';
import type { HousekeepingBoardRoom } from '../../../types/housekeeping.types';
import type { RoomStatusUpdateInput } from '../../../types/room.types';
import { roomStatusMeta, ROOM_STATUS_TRANSITIONS } from '../housekeepingConfig';

const TARGET_HINTS: Record<string, string> = {
  available: 'Mark clean and ready to sell',
  dirty: 'Flag for cleaning',
  maintenance: 'Block for maintenance work',
  out_of_order: 'Take out of service — cannot be sold',
};

interface RoomStatusUpdateDialogProps {
  open: boolean;
  room: HousekeepingBoardRoom | null;
  onClose: () => void;
  onSubmit: (roomId: number, input: RoomStatusUpdateInput) => Promise<void>;
}

export default function RoomStatusUpdateDialog({
  open,
  room,
  onClose,
  onSubmit,
}: RoomStatusUpdateDialogProps) {
  const [status, setStatus] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  if (!room) return null;

  // Only targets the DB transition table accepts from this room's status —
  // `occupied`/`reserved`/`reserved_dirty`/`cleaning` stay booking-/system-
  // driven and are never offered (see ROOM_STATUS_TRANSITIONS).
  const targets = ROOM_STATUS_TRANSITIONS[room.status] ?? [];

  const handleSubmit = async () => {
    if (!status) {
      setError('Please select a status');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(room.id, {
        status: status as RoomStatusUpdateInput['status'],
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to update room status'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Update status — Room {room.room_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Current:
            </Typography>
            <StatusChip status={room.status} tone={roomStatusMeta(room.status).tone} />
          </Stack>
          <FormControl fullWidth required>
            <InputLabel id="room-status-target">New status</InputLabel>
            <Select
              labelId="room-status-target"
              label="New status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              disabled={saving}
            >
              {targets.map((target) => (
                <MenuItem key={target} value={target}>
                  {formatStatusLabel(target)} — {TARGET_HINTS[target]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Notes (optional)"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            disabled={saving}
            placeholder="Reason for the status change…"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !status}>
          {saving ? 'Updating…' : 'Update status'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
