import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import StatusChip from '../../../components/common/StatusChip';
import { errorMessage } from '../../../utils/errorMessage';
import { formatHotelDate, formatHotelDateTime } from '../../../utils/date';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type {
  MaintenanceStatus,
  MaintenanceTicket,
  UpdateMaintenanceTicketRequest,
} from '../../../types/maintenance.types';
import {
  MAINTENANCE_PRIORITY_META,
  MAINTENANCE_TRANSITIONS,
} from '../housekeepingConfig';
import { useAssignableStaff } from '../hooks/useHousekeepingQueries';

const STATUS_ACTION_KEY: Partial<Record<MaintenanceStatus, string>> = {
  in_progress: 'maint.actionInProgress',
  on_hold: 'maint.actionOnHold',
  resolved: 'maint.actionResolved',
  closed: 'maint.actionClosed',
  open: 'maint.actionOpen',
};

interface TicketDetailDialogProps {
  open: boolean;
  ticket: MaintenanceTicket | null;
  canWrite: boolean;
  onClose: () => void;
  onSubmit: (id: number, input: UpdateMaintenanceTicketRequest) => Promise<void>;
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right', maxWidth: '65%' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function TicketDetailDialog({
  open,
  ticket,
  canWrite,
  onClose,
  onSubmit,
}: TicketDetailDialogProps) {
  const { t } = useTranslation('housekeeping');
  const [assignee, setAssignee] = useState('__keep__');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staffQuery = useAssignableStaff('maintenance', open && canWrite);
  const staff = staffQuery.data ?? [];

  useEffect(() => {
    if (open) {
      setAssignee('__keep__');
      setResolutionNotes('');
      setError(null);
    }
  }, [open, ticket?.id]);

  if (!ticket) return null;

  const nextStatuses = MAINTENANCE_TRANSITIONS[ticket.status] ?? [];

  const submit = async (input: UpdateMaintenanceTicketRequest) => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(ticket.id, input);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('errors.updateTicket')));
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = (status: MaintenanceStatus) =>
    submit({
      status,
      resolution_notes:
        status === 'resolved' && resolutionNotes.trim() ? resolutionNotes.trim() : undefined,
    });

  const handleSaveAssignee = () => {
    if (assignee === '__keep__') {
      onClose();
      return;
    }
    void submit(
      assignee === '__unassigned__'
        ? { clear_assignee: true }
        : { assigned_to: Number(assignee) },
    );
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {ticket.ticket_number}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {ticket.title}
            </Typography>
            {ticket.description ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {ticket.description}
              </Typography>
            ) : null}
          </Box>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <StatusChip status={ticket.status} domain="maintenance" />
            <StatusChip
              status={ticket.priority}
              label={t('ticketDetail.priorityLabel', { name: statusLabel(t, 'priority', ticket.priority) })}
              tone={MAINTENANCE_PRIORITY_META[ticket.priority].tone}
            />
            <Chip size="small" variant="outlined" label={statusLabel(t, 'maintenance_category', ticket.category)} />
            {ticket.room_number ? (
              <Chip size="small" variant="outlined" label={t('card.roomN', { number: ticket.room_number })} />
            ) : null}
          </Stack>
          <Divider />
          <Stack spacing={0.75}>
            <DetailRow label={t('tasks.colAssignedTo')} value={ticket.assigned_to_name ?? t('card.unassigned')} />
            <DetailRow
              label={t('ticketDetail.scheduled')}
              value={ticket.scheduled_date ? formatHotelDate(ticket.scheduled_date) : undefined}
            />
            <DetailRow
              label={t('ticketDetail.started')}
              value={ticket.started_at ? formatHotelDateTime(ticket.started_at) : undefined}
            />
            <DetailRow
              label={t('ticketDetail.resolved')}
              value={ticket.resolved_at ? formatHotelDateTime(ticket.resolved_at) : undefined}
            />
            <DetailRow label={t('ticketDetail.resolutionNotes')} value={ticket.resolution_notes} />
            <DetailRow label={t('ticketDetail.estimatedCost')} value={ticket.estimated_cost} />
            <DetailRow label={t('ticketDetail.actualCost')} value={ticket.actual_cost} />
            <DetailRow label={t('ticketDetail.created')} value={formatHotelDateTime(ticket.created_at)} />
          </Stack>
          {canWrite ? (
            <>
              <Divider />
              {ticket.status === 'in_progress' ? (
                <TextField
                  label={t('ticketDetail.resolutionField')}
                  value={resolutionNotes}
                  onChange={(event) => setResolutionNotes(event.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                  disabled={saving}
                />
              ) : null}
              <FormControl fullWidth size="small">
                <InputLabel id="ticket-assignee">{t('ticketDetail.reassign')}</InputLabel>
                <Select
                  labelId="ticket-assignee"
                  label={t('ticketDetail.reassign')}
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  disabled={saving || staffQuery.isLoading}
                >
                  <MenuItem value="__keep__">
                    {ticket.assigned_to_name ? t('editTask.keepAssignee', { name: ticket.assigned_to_name }) : t('editTask.keepUnassigned')}
                  </MenuItem>
                  {ticket.assigned_to ? <MenuItem value="__unassigned__">{t('editTask.unassign')}</MenuItem> : null}
                  {staff
                    .filter((member) => member.id !== ticket.assigned_to)
                    .map((member) => (
                      <MenuItem key={member.id} value={String(member.id)}>
                        {member.full_name || member.username}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.close')}
        </Button>
        {canWrite && assignee !== '__keep__' ? (
          <Button variant="outlined" onClick={handleSaveAssignee} disabled={saving}>
            {t('ticketDetail.saveAssignee')}
          </Button>
        ) : null}
        {canWrite
          ? nextStatuses.map((status) => (
              <Button
                key={status}
                variant={status === 'resolved' ? 'contained' : 'outlined'}
                color={status === 'closed' ? 'inherit' : status === 'resolved' ? 'success' : 'primary'}
                disabled={saving}
                onClick={() => handleStatus(status)}
              >
                {STATUS_ACTION_KEY[status] ? t(STATUS_ACTION_KEY[status]!) : statusLabel(t, 'maintenance', status)}
              </Button>
            ))
          : null}
      </DialogActions>
    </Dialog>
  );
}
