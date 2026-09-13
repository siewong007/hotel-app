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
} from '@mui/material';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../../utils/errorMessage';
import { formatStatusLabel } from '../../../utils/formatters';
import type {
  CreateMaintenanceTicketRequest,
  MaintenanceCategory,
  MaintenancePriority,
} from '../../../types/maintenance.types';
import type { HousekeepingBoardRoom } from '../../../types/housekeeping.types';
import { MAINTENANCE_PRIORITIES } from '../housekeepingConfig';
import { useRooms } from '../../rooms/hooks/useRoomQueries';
import { useAssignableStaff } from '../hooks/useHousekeepingQueries';

const CATEGORIES: MaintenanceCategory[] = [
  'electrical',
  'plumbing',
  'hvac',
  'furniture',
  'appliance',
  'structural',
  'other',
];

interface NewTicketDialogProps {
  open: boolean;
  /** When opened from a room card/drawer, the room is fixed and pre-selected. */
  initialRoom?: HousekeepingBoardRoom | null;
  onClose: () => void;
  onSubmit: (input: CreateMaintenanceTicketRequest) => Promise<void>;
}

interface FormState {
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  roomId: string;
  assignedTo: string;
}

const initialState = (room?: HousekeepingBoardRoom | null): FormState => ({
  title: '',
  description: '',
  category: 'other',
  priority: 'medium',
  roomId: room ? String(room.id) : '',
  assignedTo: '',
});

export default function NewTicketDialog({
  open,
  initialRoom,
  onClose,
  onSubmit,
}: NewTicketDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(initialRoom));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The room picker falls back to the full room list when no room was passed in.
  const roomsQuery = useRooms(open && !initialRoom);
  const staffQuery = useAssignableStaff('maintenance', open);
  const rooms = roomsQuery.data ?? [];
  const staff = staffQuery.data ?? [];

  useEffect(() => {
    if (open) {
      setForm(initialState(initialRoom));
      setError(null);
    }
  }, [open, initialRoom]);

  const patch = (update: Partial<FormState>) => setForm((prev) => ({ ...prev, ...update }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      setError('Please give the ticket a title');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        priority: form.priority,
        room_id: form.roomId ? Number(form.roomId) : undefined,
        assigned_to: form.assignedTo ? Number(form.assignedTo) : undefined,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create ticket'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New maintenance ticket</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Title"
            required
            value={form.title}
            onChange={(event) => patch({ title: event.target.value })}
            fullWidth
            disabled={saving}
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(event) => patch({ description: event.target.value })}
            multiline
            minRows={2}
            fullWidth
            disabled={saving}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="maintenance-new-category">Category</InputLabel>
              <Select
                labelId="maintenance-new-category"
                label="Category"
                value={form.category}
                onChange={(event) =>
                  patch({ category: event.target.value as MaintenanceCategory })
                }
                disabled={saving}
              >
                {CATEGORIES.map((category) => (
                  <MenuItem key={category} value={category}>
                    {formatStatusLabel(category)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="maintenance-new-priority">Priority</InputLabel>
              <Select
                labelId="maintenance-new-priority"
                label="Priority"
                value={form.priority}
                onChange={(event) =>
                  patch({ priority: event.target.value as MaintenancePriority })
                }
                disabled={saving}
              >
                {MAINTENANCE_PRIORITIES.map((priority) => (
                  <MenuItem key={priority} value={priority}>
                    {formatStatusLabel(priority)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="maintenance-new-room">Room (optional)</InputLabel>
              <Select
                labelId="maintenance-new-room"
                label="Room (optional)"
                value={form.roomId}
                onChange={(event) => patch({ roomId: event.target.value })}
                disabled={saving || Boolean(initialRoom) || roomsQuery.isLoading}
              >
                <MenuItem value="">No room</MenuItem>
                {initialRoom ? (
                  <MenuItem value={String(initialRoom.id)}>
                    Room {initialRoom.room_number}
                  </MenuItem>
                ) : (
                  rooms.map((room) => (
                    <MenuItem key={room.id} value={String(room.id)}>
                      Room {room.room_number}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="maintenance-new-assignee">Assign to (optional)</InputLabel>
              <Select
                labelId="maintenance-new-assignee"
                label="Assign to (optional)"
                value={form.assignedTo}
                onChange={(event) => patch({ assignedTo: event.target.value })}
                disabled={saving || staffQuery.isLoading}
              >
                <MenuItem value="">Unassigned</MenuItem>
                {staff.map((member) => (
                  <MenuItem key={member.id} value={String(member.id)}>
                    {member.full_name || member.username}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.title.trim()}>
          {saving ? 'Creating…' : 'Create ticket'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
