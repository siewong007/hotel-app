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
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import StatusChip from '../../../components/common/StatusChip';
import { errorMessage } from '../../../utils/errorMessage';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type {
  HousekeepingPriority,
  HousekeepingTask,
  UpdateHousekeepingTaskRequest,
} from '../../../types/housekeeping.types';
import { PRIORITIES } from '../housekeepingConfig';
import { useAssignableStaff } from '../hooks/useHousekeepingQueries';

interface TaskEditDialogProps {
  open: boolean;
  task: HousekeepingTask | null;
  onClose: () => void;
  onSubmit: (taskId: number, input: UpdateHousekeepingTaskRequest) => Promise<void>;
}

interface FormState {
  priority: HousekeepingPriority;
  /** '' = keep current, '__unassigned__' = clear, otherwise user id. */
  assignee: string;
  scheduledDate: string;
  notes: string;
  inspectionNotes: string;
}

const KEEP = '__keep__';
const CLEAR = '__unassigned__';

const stateFromTask = (task: HousekeepingTask): FormState => ({
  priority: task.priority,
  assignee: KEEP,
  scheduledDate: task.scheduled_date ?? '',
  notes: task.notes ?? '',
  inspectionNotes: task.inspection_notes ?? '',
});

export default function TaskEditDialog({ open, task, onClose, onSubmit }: TaskEditDialogProps) {
  const { t } = useTranslation('housekeeping');
  const [form, setForm] = useState<FormState>(() => (task ? stateFromTask(task) : ({} as FormState)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staffQuery = useAssignableStaff('housekeeping', open);
  const staff = staffQuery.data ?? [];

  useEffect(() => {
    if (open && task) {
      setForm(stateFromTask(task));
      setError(null);
    }
  }, [open, task]);

  if (!task) return null;

  const patch = (update: Partial<FormState>) => setForm((prev) => ({ ...prev, ...update }));

  const handleSubmit = async () => {
    if (task.scheduled_date && !form.scheduledDate) {
      setError(t('editTask.errDateCleared'));
      return;
    }
    if ((task.notes && !form.notes.trim()) || (task.inspection_notes && !form.inspectionNotes.trim())) {
      setError(t('editTask.errNotesCleared'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: UpdateHousekeepingTaskRequest = {
        priority: form.priority,
        notes: form.notes.trim() || undefined,
        inspection_notes: form.inspectionNotes.trim() || undefined,
      };
      if (form.scheduledDate !== (task.scheduled_date ?? '')) {
        input.scheduled_date = form.scheduledDate || undefined;
      }
      if (form.assignee === CLEAR) {
        input.clear_assignee = true;
      } else if (form.assignee !== KEEP) {
        input.assigned_to = Number(form.assignee);
      }
      await onSubmit(task.id, input);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('errors.updateTask')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('editTask.title', { room: task.room_number })}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {statusLabel(t, 'task_type', task.task_type)}
            </Typography>
            <StatusChip status={task.status} domain="housekeeping" />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="edit-task-priority">{t('board.priority')}</InputLabel>
              <Select
                labelId="edit-task-priority"
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
            <FormControl fullWidth>
              <InputLabel id="edit-task-assignee">{t('tasks.colAssignedTo')}</InputLabel>
              <Select
                labelId="edit-task-assignee"
                label={t('tasks.colAssignedTo')}
                value={form.assignee}
                onChange={(event) => patch({ assignee: event.target.value })}
                disabled={saving || staffQuery.isLoading}
              >
                <MenuItem value={KEEP}>
                  {task.assigned_to_name
                    ? t('editTask.keepAssignee', { name: task.assigned_to_name })
                    : t('editTask.keepUnassigned')}
                </MenuItem>
                {task.assigned_to ? <MenuItem value={CLEAR}>{t('editTask.unassign')}</MenuItem> : null}
                {staff
                  .filter((member) => member.id !== task.assigned_to)
                  .map((member) => (
                    <MenuItem key={member.id} value={String(member.id)}>
                      {member.full_name || member.username}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Stack>
          <ModernDatePicker
            label={t('editTask.scheduledDate')}
            value={form.scheduledDate}
            onChange={(value) => patch({ scheduledDate: value })}
            disabled={saving}
            fullWidth
          />
          <TextField
            label={t('common:field.notes')}
            value={form.notes}
            onChange={(event) => patch({ notes: event.target.value })}
            multiline
            minRows={2}
            fullWidth
            disabled={saving}
          />
          {task.task_type === 'inspection' ? (
            <TextField
              label={t('editTask.inspectionNotes')}
              value={form.inspectionNotes}
              onChange={(event) => patch({ inspectionNotes: event.target.value })}
              multiline
              minRows={2}
              fullWidth
              disabled={saving}
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {saving ? t('editTask.saving') : t('editTask.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
