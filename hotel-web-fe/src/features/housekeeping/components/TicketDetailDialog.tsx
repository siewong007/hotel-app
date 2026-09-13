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
import { formatStatusLabel } from '../../../utils/formatters';
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

const STATUS_ACTION_LABEL: Partial<Record<MaintenanceStatus, string>> = {
  in_progress: 'Start work',
  on_hold: 'Put on hold',
  resolved: 'Resolve',
  closed: 'Close',
  open: 'Reopen',
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
      setError(errorMessage(err, 'Failed to update ticket'));
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
            <StatusChip status={ticket.status} />
            <StatusChip
              status={ticket.priority}
              label={`${formatStatusLabel(ticket.priority)} priority`}
              tone={MAINTENANCE_PRIORITY_META[ticket.priority].tone}
            />
            <Chip size="small" variant="outlined" label={formatStatusLabel(ticket.category)} />
            {ticket.room_number ? (
              <Chip size="small" variant="outlined" label={`Room ${ticket.room_number}`} />
            ) : null}
          </Stack>
          <Divider />
          <Stack spacing={0.75}>
            <DetailRow label="Assigned to" value={ticket.assigned_to_name ?? 'Unassigned'} />
            <DetailRow
              label="Scheduled"
              value={ticket.scheduled_date ? formatHotelDate(ticket.scheduled_date) : undefined}
            />
            <DetailRow
              label="Started"
              value={ticket.started_at ? formatHotelDateTime(ticket.started_at) : undefined}
            />
            <DetailRow
              label="Resolved"
              value={ticket.resolved_at ? formatHotelDateTime(ticket.resolved_at) : undefined}
            />
            <DetailRow label="Resolution notes" value={ticket.resolution_notes} />
            <DetailRow label="Estimated cost" value={ticket.estimated_cost} />
            <DetailRow label="Actual cost" value={ticket.actual_cost} />
            <DetailRow label="Created" value={formatHotelDateTime(ticket.created_at)} />
          </Stack>
          {canWrite ? (
            <>
              <Divider />
              {ticket.status === 'in_progress' ? (
                <TextField
                  label="Resolution notes (saved when resolving)"
                  value={resolutionNotes}
                  onChange={(event) => setResolutionNotes(event.target.value)}
                  multiline
                  minRows={2}
                  fullWidth
                  disabled={saving}
                />
              ) : null}
              <FormControl fullWidth size="small">
                <InputLabel id="ticket-assignee">Reassign</InputLabel>
                <Select
                  labelId="ticket-assignee"
                  label="Reassign"
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                  disabled={saving || staffQuery.isLoading}
                >
                  <MenuItem value="__keep__">
                    {ticket.assigned_to_name ? `Keep ${ticket.assigned_to_name}` : 'Keep unassigned'}
                  </MenuItem>
                  {ticket.assigned_to ? <MenuItem value="__unassigned__">Unassign</MenuItem> : null}
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
          Close
        </Button>
        {canWrite && assignee !== '__keep__' ? (
          <Button variant="outlined" onClick={handleSaveAssignee} disabled={saving}>
            Save assignee
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
                {STATUS_ACTION_LABEL[status] ?? formatStatusLabel(status)}
              </Button>
            ))
          : null}
      </DialogActions>
    </Dialog>
  );
}
