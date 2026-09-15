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
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoardRoom,
  HousekeepingPriority,
  HousekeepingTaskType,
} from '../../../types/housekeeping.types';
import { PRIORITIES, TASK_TYPES } from '../housekeepingConfig';
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
  const { t } = useTranslation('housekeeping');
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
      setError(t('newTask.chooseRoom'));
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
      setError(errorMessage(err, t('errors.createTask')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('newTask.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <FormControl fullWidth required>
            <InputLabel id="new-task-room">{t('newTask.room')}</InputLabel>
            <Select
              labelId="new-task-room"
              label={t('newTask.room')}
              value={form.roomId}
              onChange={(event) => patch({ roomId: event.target.value })}
              disabled={saving || Boolean(initialRoom)}
            >
              {rooms.map((room) => (
                <MenuItem key={room.id} value={String(room.id)}>
                  {t('card.roomN', { number: room.room_number })} · {room.room_type} · {statusLabel(t, 'room', room.status)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="new-task-type">{t('tasks.taskType')}</InputLabel>
              <Select
                labelId="new-task-type"
                label={t('tasks.taskType')}
                value={form.taskType}
                onChange={(event) => patch({ taskType: event.target.value as HousekeepingTaskType })}
                disabled={saving}
              >
                {TASK_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {statusLabel(t, 'task_type', type)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel id="new-task-priority">{t('board.priority')}</InputLabel>
              <Select
                labelId="new-task-priority"
                label={t('board.priority')}
                value={form.priority}
                onChange={(event) =>
                  patch({ priority: event.target.value as HousekeepingPriority })
                }
                disabled={saving}
              >
                {PRIORITIES.map((priority) => (
                  <MenuItem key={priority} value={priority}>
                    {statusLabel(t, 'priority', priority)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="new-task-assignee">{t('newTask.assignTo')}</InputLabel>
              <Select
                labelId="new-task-assignee"
                label={t('newTask.assignTo')}
                value={form.assignedTo}
                onChange={(event) => patch({ assignedTo: event.target.value })}
                disabled={saving || staffQuery.isLoading}
              >
                <MenuItem value="">{t('card.unassigned')}</MenuItem>
                {staff.map((member) => (
                  <MenuItem key={member.id} value={String(member.id)}>
                    {member.full_name || member.username}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <ModernDatePicker
              label={t('newTask.scheduledDate')}
              value={form.scheduledDate}
              onChange={(value) => patch({ scheduledDate: value })}
              disabled={saving}
              fullWidth
            />
          </Stack>
          <TextField
            label={t('common:field.notes')}
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            multiline
            minRows={2}
            fullWidth
            disabled={saving}
            placeholder={t('newTask.notesPlaceholder')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !form.roomId}>
          {saving ? t('newTask.creating') : t('newTask.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
