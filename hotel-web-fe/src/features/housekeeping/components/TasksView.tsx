import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
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
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SearchIcon from '@mui/icons-material/Search';
import { useMemo, useState } from 'react';
import EmptyState from '../../../components/common/EmptyState';
import StatusChip from '../../../components/common/StatusChip';
import { formatHotelDate, formatHotelDateTime, toHotelDateString } from '../../../utils/date';
import { formatStatusLabel } from '../../../utils/formatters';
import type {
  HousekeepingBoardRoom,
  HousekeepingPriority,
  HousekeepingTask,
  HousekeepingTaskType,
  ListHousekeepingTasksQuery,
} from '../../../types/housekeeping.types';
import {
  isOpenTask,
  isTaskOverdue,
  PRIORITIES,
  PRIORITY_META,
  TASK_TYPES,
  taskTypeLabel,
} from '../housekeepingConfig';
import { useHousekeepingTasks } from '../hooks/useHousekeepingQueries';
import type { HousekeepingActionContext, HousekeepingActionHandlers } from './RoomTaskCard';

export type TaskQuickFilter = 'open' | 'mine' | 'unassigned' | 'today' | 'completed' | 'all';

const QUICK_FILTERS: { key: TaskQuickFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'today', label: 'Due today' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All tasks' },
];

const buildQuery = (quick: TaskQuickFilter, currentUserId?: number): ListHousekeepingTasksQuery => {
  const base: ListHousekeepingTasksQuery = { page_size: 200 };
  switch (quick) {
    case 'mine':
      return currentUserId ? { ...base, assigned_to: currentUserId } : base;
    case 'unassigned':
      return { ...base, unassigned: true };
    case 'today':
      return { ...base, scheduled_date: toHotelDateString(new Date()) };
    case 'completed':
      return { ...base, status: 'completed' };
    default:
      return base;
  }
};

interface TasksViewProps extends HousekeepingActionContext {
  /** Board rooms keyed by id, so a task row can open the room drawer. */
  roomById: Map<number, HousekeepingBoardRoom>;
  actions: HousekeepingActionHandlers;
  /** Controlled quick filter so page-level summaries can deep-link here. */
  quick: TaskQuickFilter;
  onQuickChange: (quick: TaskQuickFilter) => void;
}

function TaskActions({
  task,
  actions,
  ctx,
}: {
  task: HousekeepingTask;
  actions: HousekeepingActionHandlers;
  ctx: HousekeepingActionContext;
}) {
  const busy = ctx.busyTaskId === task.id;
  if (!ctx.canUpdate) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      {task.status === 'pending' ? (
        <Button
          size="small"
          variant="contained"
          startIcon={<PlayArrowIcon />}
          disabled={busy}
          aria-label={`Start ${taskTypeLabel(task.task_type)} on room ${task.room_number}`}
          onClick={() => actions.onStartTask(task)}
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
          disabled={busy}
          aria-label={`Complete ${taskTypeLabel(task.task_type)} on room ${task.room_number}`}
          onClick={() => actions.onCompleteTask(task)}
        >
          Complete
        </Button>
      ) : null}
      {!task.assigned_to && ctx.currentUserId ? (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AssignmentIndIcon />}
          disabled={busy}
          aria-label={`Assign room ${task.room_number} task to me`}
          onClick={() => actions.onAssignMe(task)}
        >
          Assign me
        </Button>
      ) : null}
      {task.status !== 'completed' && task.status !== 'void' ? (
        <>
          <Tooltip title="Edit task">
            <IconButton
              size="small"
              aria-label={`Edit task for room ${task.room_number}`}
              disabled={busy}
              onClick={() => actions.onEditTask(task)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Void task">
            <IconButton
              size="small"
              aria-label={`Void task for room ${task.room_number}`}
              disabled={busy}
              onClick={() => actions.onVoidTask(task)}
            >
              <EventBusyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      ) : null}
    </Stack>
  );
}

function TaskChips({ task }: { task: HousekeepingTask }) {
  const overdue = isTaskOverdue(task);
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
      <Chip size="small" variant="outlined" label={taskTypeLabel(task.task_type)} />
      <StatusChip
        status={task.priority}
        label={formatStatusLabel(task.priority)}
        tone={PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'}
      />
      <StatusChip status={task.status} />
      {overdue ? <Chip size="small" color="error" label="Overdue" /> : null}
    </Stack>
  );
}

export default function TasksView({ roomById, actions, quick, onQuickChange, ...ctx }: TasksViewProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [taskType, setTaskType] = useState('all');

  const queryParams = useMemo(() => buildQuery(quick, ctx.currentUserId), [quick, ctx.currentUserId]);
  const tasksQuery = useHousekeepingTasks(queryParams);

  const tasks = useMemo(() => {
    let items = tasksQuery.data?.items ?? [];
    if (quick === 'open') items = items.filter(isOpenTask);
    const needle = search.trim().toLowerCase();
    if (needle) {
      items = items.filter((task) =>
        `${task.room_number} ${task.room_type} ${task.assigned_to_name ?? ''} ${taskTypeLabel(task.task_type)}`
          .toLowerCase()
          .includes(needle),
      );
    }
    if (priority !== 'all') items = items.filter((task) => task.priority === priority);
    if (taskType !== 'all') items = items.filter((task) => task.task_type === taskType);
    return items;
  }, [tasksQuery.data, quick, search, priority, taskType]);

  const viewRoom = (task: HousekeepingTask) => {
    const room = roomById.get(task.room_id);
    if (room) actions.onViewRoom(room);
  };

  const extraFiltersActive = search.trim() !== '' || priority !== 'all' || taskType !== 'all';

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {QUICK_FILTERS.map((filter) => (
          <Chip
            key={filter.key}
            label={filter.label}
            color={quick === filter.key ? 'primary' : 'default'}
            variant={quick === filter.key ? 'filled' : 'outlined'}
            onClick={() => onQuickChange(filter.key)}
            aria-pressed={quick === filter.key}
            sx={{ fontWeight: 600 }}
          />
        ))}
      </Stack>

      <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search room or assignee…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': 'Search tasks' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: { xs: '100%', sm: 200 } }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="tasks-priority-filter">Priority</InputLabel>
          <Select
            labelId="tasks-priority-filter"
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <MenuItem value="all">All priorities</MenuItem>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} value={p}>
                {formatStatusLabel(p)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="tasks-type-filter">Task type</InputLabel>
          <Select
            labelId="tasks-type-filter"
            label="Task type"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
          >
            <MenuItem value="all">All types</MenuItem>
            {TASK_TYPES.map((type: HousekeepingTaskType) => (
              <MenuItem key={type} value={type}>
                {taskTypeLabel(type)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto' }}>
          {tasksQuery.data ? `${tasks.length} of ${tasksQuery.data.total} tasks` : ''}
        </Typography>
      </Stack>

      {tasksQuery.error ? (
        <Alert severity="error" action={<Button onClick={() => tasksQuery.refetch()}>Retry</Button>}>
          Failed to load housekeeping tasks.
        </Alert>
      ) : null}

      {tasksQuery.isLoading ? (
        <Stack spacing={1}>
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} variant="rounded" height={52} />
          ))}
        </Stack>
      ) : tasks.length === 0 ? (
        <EmptyState
          title={extraFiltersActive ? 'No tasks match these filters' : 'No tasks here'}
          description={
            quick === 'mine'
              ? 'Nothing is assigned to you right now.'
              : quick === 'unassigned'
                ? 'Every open task has an assignee.'
                : quick === 'today'
                  ? 'Nothing is scheduled for today.'
                  : extraFiltersActive
                    ? 'Try widening the search or clearing a filter.'
                    : 'No housekeeping tasks in this view.'
          }
        />
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {tasks.map((task) => (
            <Box
              key={task.id}
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}
            >
              <Stack spacing={1}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2">Room {task.room_number}</Typography>
                  <IconButton
                    size="small"
                    aria-label={`Room ${task.room_number} details`}
                    onClick={() => viewRoom(task)}
                    disabled={!roomById.has(task.room_id)}
                  >
                    <InfoOutlinedIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <TaskChips task={task} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {task.assigned_to_name ?? 'Unassigned'}
                  {task.scheduled_date ? ` · Due ${formatHotelDate(task.scheduled_date)}` : ''}
                </Typography>
                <TaskActions task={task} actions={actions} ctx={ctx} />
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" aria-label="Housekeeping tasks">
            <TableHead>
              <TableRow>
                <TableCell>Room</TableCell>
                <TableCell>Task</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Assigned to</TableCell>
                <TableCell>Scheduled</TableCell>
                <TableCell>Updated</TableCell>
                {ctx.canUpdate ? <TableCell align="right">Actions</TableCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((task) => {
                const overdue = isTaskOverdue(task);
                return (
                  <TableRow key={task.id} hover>
                    <TableCell>
                      <Button
                        size="small"
                        variant="text"
                        sx={{ p: 0, minWidth: 0, fontWeight: 700 }}
                        onClick={() => viewRoom(task)}
                        disabled={!roomById.has(task.room_id)}
                        aria-label={`Room ${task.room_number} details`}
                      >
                        {task.room_number}
                      </Button>
                    </TableCell>
                    <TableCell>{taskTypeLabel(task.task_type)}</TableCell>
                    <TableCell>
                      <StatusChip
                        status={task.priority}
                        label={formatStatusLabel(task.priority)}
                        tone={PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={task.status} />
                    </TableCell>
                    <TableCell>{task.assigned_to_name ?? '—'}</TableCell>
                    <TableCell>
                      {task.scheduled_date ? (
                        <Typography
                          variant="body2"
                          sx={{ color: overdue ? 'error.main' : 'text.primary', fontWeight: overdue ? 700 : 400 }}
                        >
                          {formatHotelDate(task.scheduled_date)}
                          {overdue ? ' · overdue' : ''}
                        </Typography>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{formatHotelDateTime(task.updated_at)}</TableCell>
                    {ctx.canUpdate ? (
                      <TableCell align="right">
                        <TaskActions task={task} actions={actions} ctx={ctx} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
