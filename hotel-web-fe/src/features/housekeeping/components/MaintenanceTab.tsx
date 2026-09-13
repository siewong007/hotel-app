import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useMemo, useState } from 'react';
import EmptyState from '../../../components/common/EmptyState';
import StatusChip from '../../../components/common/StatusChip';
import { errorMessage } from '../../../utils/errorMessage';
import { formatHotelDateTime } from '../../../utils/date';
import { formatStatusLabel } from '../../../utils/formatters';
import type {
  ListMaintenanceTicketsQuery,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceTicket,
  UpdateMaintenanceTicketRequest,
} from '../../../types/maintenance.types';
import {
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_PRIORITY_META,
  MAINTENANCE_STATUS_META,
  MAINTENANCE_STATUSES,
} from '../housekeepingConfig';
import {
  useCreateMaintenanceTicket,
  useMaintenanceTickets,
  useUpdateMaintenanceTicket,
} from '../hooks/useMaintenanceQueries';
import NewTicketDialog from './NewTicketDialog';
import TicketDetailDialog from './TicketDetailDialog';

const CATEGORIES: MaintenanceCategory[] = [
  'electrical',
  'plumbing',
  'hvac',
  'furniture',
  'appliance',
  'structural',
  'other',
];

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  ...MAINTENANCE_STATUSES.map((status) => ({
    key: status,
    label: formatStatusLabel(status),
  })),
];

interface MaintenanceTabProps {
  canWrite: boolean;
  /** Snackbar relay from the page so mutation feedback is consistent. */
  onNotify: (severity: 'success' | 'error', message: string) => void;
}

export default function MaintenanceTab({ canWrite, onNotify }: MaintenanceTabProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<MaintenanceTicket | null>(null);

  const params = useMemo<ListMaintenanceTicketsQuery>(
    () => ({
      page_size: 200,
      status: statusFilter === 'all' ? undefined : (statusFilter as MaintenanceStatus),
      category: categoryFilter === 'all' ? undefined : (categoryFilter as MaintenanceCategory),
      priority: priorityFilter === 'all' ? undefined : (priorityFilter as MaintenancePriority),
    }),
    [statusFilter, categoryFilter, priorityFilter],
  );

  const ticketsQuery = useMaintenanceTickets(params);
  const createTicket = useCreateMaintenanceTicket();
  const updateTicket = useUpdateMaintenanceTicket();

  const tickets = useMemo(() => {
    const items = ticketsQuery.data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((ticket) =>
      `${ticket.ticket_number} ${ticket.title} ${ticket.room_number ?? ''} ${ticket.assigned_to_name ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [ticketsQuery.data, search]);

  const handleCreate = async (input: Parameters<typeof createTicket.mutateAsync>[0]) => {
    await createTicket.mutateAsync(input);
    onNotify('success', 'Maintenance ticket created.');
  };

  const handleUpdate = async (id: number, input: UpdateMaintenanceTicketRequest) => {
    await updateTicket.mutateAsync({ id, input });
    onNotify('success', 'Ticket updated.');
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={1.25}
        useFlexGap
        sx={{ flexWrap: 'wrap', alignItems: 'center' }}
      >
        {STATUS_FILTERS.map((filter) => (
          <Chip
            key={filter.key}
            label={filter.label}
            color={statusFilter === filter.key ? 'primary' : 'default'}
            variant={statusFilter === filter.key ? 'filled' : 'outlined'}
            onClick={() => setStatusFilter(filter.key)}
            aria-pressed={statusFilter === filter.key}
            sx={{ fontWeight: 600 }}
          />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        {canWrite ? (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setNewTicketOpen(true)}
          >
            New ticket
          </Button>
        ) : null}
      </Stack>

      <Stack
        direction="row"
        spacing={1.25}
        useFlexGap
        sx={{ flexWrap: 'wrap', alignItems: 'center' }}
      >
        <TextField
          size="small"
          placeholder="Search ticket, title, room…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search maintenance tickets' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: { xs: '100%', sm: 220 } }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="maintenance-category-filter">Category</InputLabel>
          <Select
            labelId="maintenance-category-filter"
            label="Category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <MenuItem value="all">All categories</MenuItem>
            {CATEGORIES.map((category) => (
              <MenuItem key={category} value={category}>
                {formatStatusLabel(category)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="maintenance-priority-filter">Priority</InputLabel>
          <Select
            labelId="maintenance-priority-filter"
            label="Priority"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <MenuItem value="all">All priorities</MenuItem>
            {MAINTENANCE_PRIORITIES.map((priority) => (
              <MenuItem key={priority} value={priority}>
                {formatStatusLabel(priority)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto' }}>
          {ticketsQuery.data ? `${tickets.length} of ${ticketsQuery.data.total} tickets` : ''}
        </Typography>
      </Stack>

      {ticketsQuery.error ? (
        <Alert severity="error" action={<Button onClick={() => ticketsQuery.refetch()}>Retry</Button>}>
          {errorMessage(ticketsQuery.error, 'Failed to load maintenance tickets')}
        </Alert>
      ) : null}

      {ticketsQuery.isLoading ? (
        <Stack spacing={1}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} variant="rounded" height={52} />
          ))}
        </Stack>
      ) : tickets.length === 0 ? (
        <EmptyState
          title={search ? 'No tickets match the search' : 'No maintenance tickets'}
          description={
            statusFilter !== 'all'
              ? `Nothing is ${formatStatusLabel(statusFilter).toLowerCase()} right now.`
              : search
                ? 'Try a different ticket number, title, or room.'
                : 'Reported issues will appear here.'
          }
        />
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {tickets.map((ticket) => (
            <Box
              key={ticket.id}
              component="button"
              type="button"
              onClick={() => setSelectedTicket(ticket)}
              sx={{
                p: 2,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: 'background.paper',
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <Stack
                direction="row"
                sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {ticket.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {ticket.ticket_number}
                    {ticket.room_number ? ` · Room ${ticket.room_number}` : ''}
                    {' · '}
                    {formatStatusLabel(ticket.category)}
                    {ticket.assigned_to_name ? ` · ${ticket.assigned_to_name}` : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <StatusChip
                    status={ticket.priority}
                    label={formatStatusLabel(ticket.priority)}
                    tone={MAINTENANCE_PRIORITY_META[ticket.priority].tone}
                  />
                  <StatusChip status={ticket.status} tone={MAINTENANCE_STATUS_META[ticket.status].tone} />
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" aria-label="Maintenance tickets">
            <TableHead>
              <TableRow>
                <TableCell>Ticket</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Room</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Assigned to</TableCell>
                <TableCell>Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow
                  key={ticket.id}
                  hover
                  onClick={() => setSelectedTicket(ticket)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Button
                      size="small"
                      variant="text"
                      sx={{ p: 0, minWidth: 0, fontWeight: 700 }}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedTicket(ticket);
                      }}
                      aria-label={`Open ticket ${ticket.ticket_number}`}
                    >
                      {ticket.ticket_number}
                    </Button>
                  </TableCell>
                  <TableCell>{ticket.title}</TableCell>
                  <TableCell>{ticket.room_number ?? '—'}</TableCell>
                  <TableCell>{formatStatusLabel(ticket.category)}</TableCell>
                  <TableCell>
                    <StatusChip
                      status={ticket.priority}
                      label={formatStatusLabel(ticket.priority)}
                      tone={MAINTENANCE_PRIORITY_META[ticket.priority].tone}
                    />
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={ticket.status}
                      tone={MAINTENANCE_STATUS_META[ticket.status].tone}
                    />
                  </TableCell>
                  <TableCell>{ticket.assigned_to_name ?? '—'}</TableCell>
                  <TableCell>{formatHotelDateTime(ticket.updated_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <NewTicketDialog
        open={newTicketOpen}
        onClose={() => setNewTicketOpen(false)}
        onSubmit={handleCreate}
      />
      <TicketDetailDialog
        open={Boolean(selectedTicket)}
        ticket={selectedTicket}
        canWrite={canWrite}
        onClose={() => setSelectedTicket(null)}
        onSubmit={handleUpdate}
      />
    </Stack>
  );
}
