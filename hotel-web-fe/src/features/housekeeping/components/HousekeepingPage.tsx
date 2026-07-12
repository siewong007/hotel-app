import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useMemo, useState } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { formatLocalDate } from '../../../utils/date';
import type { HousekeepingBoardRoom, HousekeepingPriority } from '../../../types/housekeeping.types';
import {
  useCreateHousekeepingTask,
  useHousekeepingBoard,
  useUpdateHousekeepingTask,
} from '../hooks/useHousekeepingQueries';
import MaintenanceTab from './MaintenanceTab';

const ROOM_STATUS_ORDER = ['dirty', 'cleaning', 'reserved_dirty', 'maintenance', 'available', 'reserved', 'occupied'];
const PRIORITIES: HousekeepingPriority[] = ['low', 'normal', 'high', 'urgent'];

const statusLabel = (status: string) => status
  .split('_')
  .map(part => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const priorityColor = (priority?: HousekeepingPriority) => {
  switch (priority) {
    case 'urgent':
      return 'error';
    case 'high':
      return 'warning';
    case 'low':
      return 'default';
    default:
      return 'info';
  }
};

const taskStatusColor = (status?: string) => {
  switch (status) {
    case 'in_progress':
      return 'primary';
    case 'completed':
      return 'success';
    case 'void':
      return 'default';
    default:
      return 'warning';
  }
};

function RoomTaskRow({
  room,
  canUpdate,
  currentUserId,
  onCreate,
  onUpdate,
  isBusy,
}: {
  room: HousekeepingBoardRoom;
  canUpdate: boolean;
  currentUserId?: number;
  onCreate: (roomId: number, notes?: string) => void;
  onUpdate: (taskId: number, input: { status?: 'in_progress' | 'completed' | 'void'; assigned_to?: number }) => void;
  isBusy: boolean;
}) {
  const [notes, setNotes] = useState('');
  const task = room.open_task;
  const canCreateTask = !task && ['dirty', 'cleaning', 'reserved_dirty'].includes(room.status);

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.25,
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" gap={1} alignItems="center">
          <Box minWidth={0}>
            <Typography variant="subtitle2" noWrap>
              Room {room.room_number}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {room.room_type}{room.floor != null ? ` · Floor ${room.floor}` : ''}
            </Typography>
          </Box>
          <Chip size="small" label={statusLabel(room.status)} />
        </Stack>

        {task ? (
          <>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip size="small" color={priorityColor(task.priority)} label={statusLabel(task.priority)} />
              <Chip size="small" color={taskStatusColor(task.status)} label={statusLabel(task.status)} />
              {task.assigned_to_name ? <Chip size="small" label={task.assigned_to_name} /> : null}
              {task.scheduled_date ? <Chip size="small" label={task.scheduled_date} /> : null}
            </Stack>
            {task.notes ? (
              <Typography variant="body2" color="text.secondary">
                {task.notes}
              </Typography>
            ) : null}
            {canUpdate ? (
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {!task.assigned_to && currentUserId ? (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AssignmentIndIcon />}
                    disabled={isBusy}
                    onClick={() => onUpdate(task.id, { assigned_to: currentUserId })}
                  >
                    Assign me
                  </Button>
                ) : null}
                {task.status === 'pending' ? (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<PlayArrowIcon />}
                    disabled={isBusy}
                    onClick={() => onUpdate(task.id, { status: 'in_progress' })}
                  >
                    Start
                  </Button>
                ) : null}
                {task.status === 'in_progress' ? (
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<CheckCircleIcon />}
                    disabled={isBusy}
                    onClick={() => onUpdate(task.id, { status: 'completed' })}
                  >
                    Complete
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </>
        ) : (
          <Stack spacing={1}>
            {canCreateTask ? (
              <>
                <TextField
                  size="small"
                  label="Notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  fullWidth
                />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={isBusy}
                  onClick={() => {
                    onCreate(room.id, notes || undefined);
                    setNotes('');
                  }}
                >
                  Add task
                </Button>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No open task
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

export default function HousekeepingPage() {
  const { user, hasPermission } = useAuth();
  const canViewMaintenance = hasPermission('maintenance:read');
  const canWriteMaintenance = hasPermission('maintenance:write');
  const [tab, setTab] = useState(0);
  const [floorFilter, setFloorFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const boardQuery = useHousekeepingBoard();
  const createTask = useCreateHousekeepingTask();
  const updateTask = useUpdateHousekeepingTask();
  const canUpdate = hasPermission('housekeeping:update') || hasPermission('housekeeping:manage');
  const canCreate = hasPermission('housekeeping:create') || hasPermission('housekeeping:manage');
  const currentUserId = user?.id ? Number(user.id) : undefined;
  const isBusy = createTask.isPending || updateTask.isPending;

  const rooms = useMemo(() => boardQuery.data?.rooms ?? [], [boardQuery.data]);
  const floors = useMemo(
    () => Array.from(new Set(rooms.map(room => room.floor).filter((floor): floor is number => floor != null))).sort((a, b) => a - b),
    [rooms],
  );

  const filteredRooms = useMemo(() => rooms.filter((room) => {
    if (floorFilter !== 'all' && String(room.floor) !== floorFilter) return false;
    if (priorityFilter !== 'all' && room.open_task?.priority !== priorityFilter) return false;
    return true;
  }), [floorFilter, priorityFilter, rooms]);

  const groupedRooms = useMemo(() => {
    const groups = new Map<string, HousekeepingBoardRoom[]>();
    for (const room of filteredRooms) {
      const key = room.status || 'available';
      groups.set(key, [...(groups.get(key) ?? []), room]);
    }

    return Array.from(groups.entries()).sort(([a], [b]) => {
      const aIndex = ROOM_STATUS_ORDER.indexOf(a);
      const bIndex = ROOM_STATUS_ORDER.indexOf(b);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });
  }, [filteredRooms]);

  const error = boardQuery.error || createTask.error || updateTask.error;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: 'auto' }}>
      <Stack spacing={2.5}>
        {canViewMaintenance ? (
          <Tabs value={tab} onChange={(_event, value: number) => setTab(value)}>
            <Tab label="Board" />
            <Tab label="Maintenance" />
          </Tabs>
        ) : null}

        {tab === 0 ? (
          <Stack spacing={2.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
              <Box>
                <Typography variant="h4" component="h1">
                  Housekeeping
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatLocalDate()} · {filteredRooms.length} rooms
                </Typography>
              </Box>
              <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="housekeeping-floor-filter">Floor</InputLabel>
                  <Select
                    labelId="housekeeping-floor-filter"
                    label="Floor"
                    value={floorFilter}
                    onChange={(event) => setFloorFilter(event.target.value)}
                  >
                    <MenuItem value="all">All floors</MenuItem>
                    {floors.map(floor => (
                      <MenuItem key={floor} value={String(floor)}>Floor {floor}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 130 }}>
                  <InputLabel id="housekeeping-priority-filter">Priority</InputLabel>
                  <Select
                    labelId="housekeeping-priority-filter"
                    label="Priority"
                    value={priorityFilter}
                    onChange={(event) => setPriorityFilter(event.target.value)}
                  >
                    <MenuItem value="all">All priorities</MenuItem>
                    {PRIORITIES.map(priority => (
                      <MenuItem key={priority} value={priority}>{statusLabel(priority)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Stack>

            {error ? <Alert severity="error">{error instanceof Error ? error.message : 'Housekeeping update failed'}</Alert> : null}

            {boardQuery.isLoading ? (
              <Stack alignItems="center" sx={{ py: 8 }}>
                <CircularProgress />
              </Stack>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
                  gap: 2,
                  alignItems: 'start',
                }}
              >
                {groupedRooms.map(([status, statusRooms]) => (
                  <Box
                    key={status}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1.5,
                      bgcolor: 'background.default',
                      minHeight: 160,
                    }}
                  >
                    <Stack spacing={1.25}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle1">{statusLabel(status)}</Typography>
                        <Chip size="small" label={statusRooms.length} />
                      </Stack>
                      {statusRooms.map(room => (
                        <RoomTaskRow
                          key={room.id}
                          room={room}
                          canUpdate={canUpdate}
                          currentUserId={currentUserId}
                          isBusy={isBusy}
                          onCreate={(roomId, notes) => {
                            if (!canCreate) return;
                            createTask.mutate({ room_id: roomId, task_type: 'cleaning', priority: 'normal', notes });
                          }}
                          onUpdate={(taskId, input) => updateTask.mutate({ taskId, input })}
                        />
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        ) : null}

        {tab === 1 && canViewMaintenance ? <MaintenanceTab canWrite={canWriteMaintenance} /> : null}
      </Stack>
    </Box>
  );
}
