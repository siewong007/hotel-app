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
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
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
} from '../housekeepingConfig';
import { useHousekeepingTasks } from '../hooks/useHousekeepingQueries';
import type { HousekeepingActionContext, HousekeepingActionHandlers } from './RoomTaskCard';

export type TaskQuickFilter = 'open' | 'mine' | 'unassigned' | 'today' | 'completed' | 'all';

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
  const { t } = useTranslation('housekeeping');
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
          aria-label={t('card.startAria', { type: statusLabel(t, 'task_type', task.task_type), room: task.room_number })}
          onClick={() => actions.onStartTask(task)}
        >
          {t('card.start')}
        </Button>
      ) : null}
      {task.status === 'in_progress' ? (
        <Button
          size="small"
          variant="contained"
          color="success"
          startIcon={<CheckCircleIcon />}
          disabled={busy}
          aria-label={t('card.completeAria', { type: statusLabel(t, 'task_type', task.task_type), room: task.room_number })}
          onClick={() => actions.onCompleteTask(task)}
        >
          {t('card.complete')}
        </Button>
      ) : null}
      {!task.assigned_to && ctx.currentUserId ? (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AssignmentIndIcon />}
          disabled={busy}
          aria-label={t('card.assignAria', { room: task.room_number })}
          onClick={() => actions.onAssignMe(task)}
        >
          {t('card.assignMe')}
        </Button>
      ) : null}
      {task.status !== 'completed' && task.status !== 'void' ? (
        <>
          <Tooltip title={t('tasks.editTask')}>
            <IconButton
              size="small"
              aria-label={t('tasks.editTaskAria', { room: task.room_number })}
              disabled={busy}
              onClick={() => actions.onEditTask(task)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('tasks.voidTask')}>
            <IconButton
              size="small"
              aria-label={t('tasks.voidTaskAria', { room: task.room_number })}
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
  const { t } = useTranslation('housekeeping');
  const overdue = isTaskOverdue(task);
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
      <Chip size="small" variant="outlined" label={statusLabel(t, 'task_type', task.task_type)} />
      <StatusChip
        status={task.priority}
        domain="priority"
        tone={PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'}
      />
      <StatusChip status={task.status} domain="housekeeping" />
      {overdue ? <Chip size="small" color="error" label={t('tasks.overdue')} /> : null}
    </Stack>
  );
}

export default function TasksView({ roomById, actions, quick, onQuickChange, ...ctx }: TasksViewProps) {
  const { t } = useTranslation('housekeeping');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [taskType, setTaskType] = useState('all');

  const QUICK_FILTERS: { key: TaskQuickFilter; label: string }[] = [
    { key: 'open', label: t('tasks.quickOpen') },
    { key: 'mine', label: t('tasks.quickMine') },
    { key: 'unassigned', label: t('tasks.quickUnassigned') },
    { key: 'today', label: t('tasks.quickToday') },
    { key: 'completed', label: t('tasks.quickCompleted') },
    { key: 'all', label: t('tasks.quickAll') },
  ];

  const queryParams = useMemo(() => buildQuery(quick, ctx.currentUserId), [quick, ctx.currentUserId]);
  const tasksQuery = useHousekeepingTasks(queryParams);

  const tasks = useMemo(() => {
    let items = tasksQuery.data?.items ?? [];
    if (quick === 'open') items = items.filter(isOpenTask);
    const needle = search.trim().toLowerCase();
    if (needle) {
      items = items.filter((task) =>
        `${task.room_number} ${task.room_type} ${task.assigned_to_name ?? ''} ${statusLabel(t, 'task_type', task.task_type)}`
          .toLowerCase()
          .includes(needle),
      );
    }
    if (priority !== 'all') items = items.filter((task) => task.priority === priority);
    if (taskType !== 'all') items = items.filter((task) => task.task_type === taskType);
    return items;
  }, [tasksQuery.data, quick, search, priority, taskType, t]);

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
          placeholder={t('tasks.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          slotProps={{
            htmlInput: { 'aria-label': t('tasks.searchAria') },
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
          <InputLabel id="tasks-priority-filter">{t('board.priority')}</InputLabel>
          <Select
            labelId="tasks-priority-filter"
            label={t('board.priority')}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <MenuItem value="all">{t('board.allPriorities')}</MenuItem>
            {PRIORITIES.map((p) => (
              <MenuItem key={p} value={p}>
                {statusLabel(t, 'priority', p)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="tasks-type-filter">{t('tasks.taskType')}</InputLabel>
          <Select
            labelId="tasks-type-filter"
            label={t('tasks.taskType')}
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
          >
            <MenuItem value="all">{t('tasks.allTypes')}</MenuItem>
            {TASK_TYPES.map((type: HousekeepingTaskType) => (
              <MenuItem key={type} value={type}>
                {statusLabel(t, 'task_type', type)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" sx={{ color: 'text.secondary', ml: 'auto' }}>
          {tasksQuery.data ? t('tasks.countSummary', { shown: tasks.length, total: tasksQuery.data.total }) : ''}
        </Typography>
      </Stack>

      {tasksQuery.error ? (
        <Alert severity="error" action={<Button onClick={() => tasksQuery.refetch()}>{t('common:state.retry')}</Button>}>
          {t('errors.loadTasks')}
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
          title={extraFiltersActive ? t('tasks.emptyFiltered') : t('tasks.emptyTitle')}
          description={
            quick === 'mine'
              ? t('tasks.emptyMine')
              : quick === 'unassigned'
                ? t('tasks.emptyUnassigned')
                : quick === 'today'
                  ? t('tasks.emptyToday')
                  : extraFiltersActive
                    ? t('board.emptyFilteredBody')
                    : t('tasks.emptyDefault')
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
                  <Typography variant="subtitle2">{t('card.roomN', { number: task.room_number })}</Typography>
                  <IconButton
                    size="small"
                    aria-label={t('tasks.roomDetailsAria', { room: task.room_number })}
                    onClick={() => viewRoom(task)}
                    disabled={!roomById.has(task.room_id)}
                  >
                    <InfoOutlinedIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <TaskChips task={task} />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {task.assigned_to_name ?? t('card.unassigned')}
                  {task.scheduled_date ? ` · ${t('card.due', { date: formatHotelDate(task.scheduled_date) })}` : ''}
                </Typography>
                <TaskActions task={task} actions={actions} ctx={ctx} />
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <Table size="small" aria-label={t('tasks.tableAria')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('tasks.colRoom')}</TableCell>
                <TableCell>{t('tasks.colTask')}</TableCell>
                <TableCell>{t('tasks.colPriority')}</TableCell>
                <TableCell>{t('tasks.colStatus')}</TableCell>
                <TableCell>{t('tasks.colAssignedTo')}</TableCell>
                <TableCell>{t('tasks.colScheduled')}</TableCell>
                <TableCell>{t('tasks.colUpdated')}</TableCell>
                {ctx.canUpdate ? <TableCell align="right">{t('tasks.colActions')}</TableCell> : null}
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
                        aria-label={t('tasks.roomDetailsAria', { room: task.room_number })}
                      >
                        {task.room_number}
                      </Button>
                    </TableCell>
                    <TableCell>{statusLabel(t, 'task_type', task.task_type)}</TableCell>
                    <TableCell>
                      <StatusChip
                        status={task.priority}
                        domain="priority"
                        tone={PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusChip status={task.status} domain="housekeeping" />
                    </TableCell>
                    <TableCell>{task.assigned_to_name ?? '—'}</TableCell>
                    <TableCell>
                      {task.scheduled_date ? (
                        <Typography
                          variant="body2"
                          sx={{ color: overdue ? 'error.main' : 'text.primary', fontWeight: overdue ? 700 : 400 }}
                        >
                          {formatHotelDate(task.scheduled_date)}
                          {overdue ? t('tasks.overdueSuffix') : ''}
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
