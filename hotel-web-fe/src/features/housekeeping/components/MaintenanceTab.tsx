import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import { useState } from 'react';
import { useRooms } from '../../rooms/hooks/useRoomQueries';
import type {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
} from '../../../types/maintenance.types';
import {
  useCreateMaintenanceTicket,
  useMaintenanceTickets,
  useUpdateMaintenanceTicket,
} from '../hooks/useMaintenanceQueries';

const CATEGORIES: MaintenanceCategory[] = [
  'electrical',
  'plumbing',
  'hvac',
  'furniture',
  'appliance',
  'structural',
  'other',
];
const PRIORITIES: MaintenancePriority[] = ['low', 'medium', 'high', 'critical'];

const statusLabel = (status: string) => status
  .split('_')
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const priorityColor = (priority?: MaintenancePriority) => {
  switch (priority) {
    case 'critical':
      return 'error';
    case 'high':
      return 'warning';
    case 'low':
      return 'default';
    default:
      return 'info';
  }
};

const ticketStatusColor = (status?: MaintenanceStatus) => {
  switch (status) {
    case 'in_progress':
      return 'primary';
    case 'resolved':
      return 'success';
    case 'closed':
      return 'default';
    case 'on_hold':
      return 'warning';
    default:
      return 'info';
  }
};

interface NewTicketFormState {
  title: string;
  description: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  roomId: string;
}

const initialFormState: NewTicketFormState = {
  title: '',
  description: '',
  category: 'other',
  priority: 'medium',
  roomId: '',
};

export default function MaintenanceTab({ canWrite }: { canWrite: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NewTicketFormState>(initialFormState);
  const ticketsQuery = useMaintenanceTickets();
  const roomsQuery = useRooms(dialogOpen);
  const createTicket = useCreateMaintenanceTicket();
  const updateTicket = useUpdateMaintenanceTicket();

  const tickets = ticketsQuery.data?.items ?? [];
  const rooms = roomsQuery.data ?? [];
  const isBusy = createTicket.isPending || updateTicket.isPending;
  const error = ticketsQuery.error || createTicket.error || updateTicket.error;

  const closeDialog = () => {
    setDialogOpen(false);
    setForm(initialFormState);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) return;
    createTicket.mutate(
      {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        priority: form.priority,
        room_id: form.roomId ? Number(form.roomId) : undefined,
      },
      { onSuccess: closeDialog },
    );
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Typography variant="body2" color="text.secondary">
          {tickets.length} tickets
        </Typography>
        {canWrite ? (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setDialogOpen(true)}
          >
            New ticket
          </Button>
        ) : null}
      </Stack>

      {error ? (
        <Alert severity="error">
          {error instanceof Error ? error.message : 'Maintenance request failed'}
        </Alert>
      ) : null}

      {ticketsQuery.isLoading ? (
        <Stack alignItems="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Ticket</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Room</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Assigned to</TableCell>
                {canWrite ? <TableCell align="right">Actions</TableCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow key={ticket.id} hover>
                  <TableCell>{ticket.ticket_number}</TableCell>
                  <TableCell>{ticket.title}</TableCell>
                  <TableCell>{ticket.room_number ?? '—'}</TableCell>
                  <TableCell>{statusLabel(ticket.category)}</TableCell>
                  <TableCell>
                    <Chip size="small" color={priorityColor(ticket.priority)} label={statusLabel(ticket.priority)} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={ticketStatusColor(ticket.status)} label={statusLabel(ticket.status)} />
                  </TableCell>
                  <TableCell>{ticket.assigned_to_name ?? '—'}</TableCell>
                  {canWrite ? (
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                        {ticket.status === 'open' || ticket.status === 'on_hold' ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PlayArrowIcon />}
                            disabled={isBusy}
                            onClick={() => updateTicket.mutate({ id: ticket.id, input: { status: 'in_progress' } })}
                          >
                            Start
                          </Button>
                        ) : null}
                        {ticket.status === 'in_progress' ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="success"
                            startIcon={<CheckCircleIcon />}
                            disabled={isBusy}
                            onClick={() => updateTicket.mutate({ id: ticket.id, input: { status: 'resolved' } })}
                          >
                            Resolve
                          </Button>
                        ) : null}
                        {ticket.status !== 'closed' ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<CloseIcon />}
                            disabled={isBusy}
                            onClick={() => updateTicket.mutate({ id: ticket.id, input: { status: 'closed' } })}
                          >
                            Close
                          </Button>
                        ) : null}
                      </Stack>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
              {tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 8 : 7}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                      No maintenance tickets
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>New maintenance ticket</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              required
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              fullWidth
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              multiline
              minRows={2}
              fullWidth
            />
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth>
                <InputLabel id="maintenance-new-category">Category</InputLabel>
                <Select
                  labelId="maintenance-new-category"
                  label="Category"
                  value={form.category}
                  onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as MaintenanceCategory }))}
                >
                  {CATEGORIES.map((category) => (
                    <MenuItem key={category} value={category}>{statusLabel(category)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="maintenance-new-priority">Priority</InputLabel>
                <Select
                  labelId="maintenance-new-priority"
                  label="Priority"
                  value={form.priority}
                  onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value as MaintenancePriority }))}
                >
                  {PRIORITIES.map((priority) => (
                    <MenuItem key={priority} value={priority}>{statusLabel(priority)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <FormControl fullWidth>
              <InputLabel id="maintenance-new-room">Room (optional)</InputLabel>
              <Select
                labelId="maintenance-new-room"
                label="Room (optional)"
                value={form.roomId}
                onChange={(event) => setForm((prev) => ({ ...prev, roomId: event.target.value }))}
              >
                <MenuItem value="">No room</MenuItem>
                {rooms.map((room) => (
                  <MenuItem key={room.id} value={String(room.id)}>Room {room.room_number}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!form.title.trim() || createTicket.isPending}
            onClick={handleSubmit}
          >
            Create ticket
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
