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
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { errorMessage } from '../../../utils/errorMessage';
import { formatStatusLabel } from '../../../utils/formatters';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoardRoom,
  HousekeepingPriority,
  HousekeepingTaskType,
} from '../../../types/housekeeping.types';
import { PRIORITIES, TASK_TYPES, taskTypeLabel } from '../housekeepingConfig';
import { useAssignableStaff } from '../hooks/useHousekeepingQueries';

interface NewTaskDialogProps {
  open: boolean;
  /** Rooms the picker may offer — board rooms are enough (id, number, type). */
  rooms: HousekeepingBoardRoom[];
  /** Pre-selected room when the dialog opens from a room card. */
  initialRoom?: HousekeepingBoardRoom | null;
  onClose: () => void;
  onSubmit: (input: CreateHousekeepingTaskRequest) => Promise<void>;
}

interface FormState {
  roomId: string;
  taskType: HousekeepingTaskType;
  priority: HousekeepingPriority;
  assignedTo: string;
  scheduledDate: string;
  notes: string;
}

const initialState = (room?: HousekeepingBoardRoom | null): FormState => ({
  roomId: room ? String(room.id) : '',
  taskType: room?.status === 'reserved_dirty' ? 'checkout_clean' : 'cleaning',
  priority: room?.status === 'reserved_dirty' ? 'high' : 'normal',
  assignedTo: '',
  scheduledDate: '',
  notes: '',
});

export default function NewTaskDialog({
  open,
  rooms,
  initialRoom,
  onClose,
  onSubmit,
}: NewTaskDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState(initialRoom));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staffQuery = useAssignableStaff('housekeeping', open);
  const staff = staffQuery.data ?? [];

  useEffect(() => {
    if (open) {
      setForm(initialState(initialRoom));
      setError(null);
    }
  }, [open, initialRoom]);

  const patch = (update: Partial<FormState>) => setForm((prev) => ({ ...prev, ...update }));

  const handleSubmit = async () => {
    if (!form.roomId) {
      setError('Please choose a room');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        room_id: Number(form.roomId),
        task_type: form.taskType,
        priority: form.priority,
        assigned_to: form.assignedTo ? Number(form.assignedTo) : undefined,
        scheduled_date: form.scheduledDate || undefined,
        notes: form.notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create task'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New housekeeping task</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <FormControl fullWidth required>
            <InputLabel id="new-task-room">Room</InputLabel>
            <Select
              labelId="new-task-room"
              label="Room"
              value={form.roomId}
              onChange={(event) => patch({ roomId: event.target.value })}
              disabled={saving || Boolean(initialRoom)}
            >
              {rooms.map((room) => (
                <MenuItem key={room.id} value={String(room.id)}>
                  Room {room.room_number} · {room.room_type} · {formatStatusLabel(room.status)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="new-task-type">Task type</InputLabel>
              <Select
                labelId="new-task-type"
                label="Task type"
                value={form.taskType}
                onChange={(event) => patch({ taskType: event.target.value as HousekeepingTaskType })}
                disabled={saving}
              >
                {TASK_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {taskTypeLabel(type)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="new-task-priority">Priority</InputLabel>
              <Select
                labelId="new-task-priority"
                label="Priority"
                value={form.priority}
                onChange={(event) =>
                  patch({ priority: event.target.value as HousekeepingPriority })
                }
                disabled={saving}
              >
                {PRIORITIES.map((priority) => (
                  <MenuItem key={priority} value={priority}>
                    {formatStatusLabel(priority)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="new-task-assignee">Assign to (optional)</InputLabel>
              <Select
                labelId="new-task-assignee"
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
            <ModernDatePicker
              label="Scheduled date (optional)"
              value={form.scheduledDate}
              onChange={(value) => patch({ scheduledDate: value })}
              disabled={saving}
              fullWidth
            />
          </Stack>
          <TextField
            label="Notes"
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            multiline
            minRows={2}
            fullWidth
            disabled={saving}
            placeholder="e.g. Extra towels requested, deep clean after long stay…"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.roomId}>
          {saving ? 'Creating…' : 'Create task'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
