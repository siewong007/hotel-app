import {
  Alert,
  Box,
  Button,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncIcon from '@mui/icons-material/Sync';
import { useMemo, useState } from 'react';
import PageHeader from '../../../components/common/PageHeader';
import StatStrip from '../../../components/common/StatStrip';
import { getTabA11yProps, TabPanel } from '../../../components/common/TabPanel';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { formatHotelDateTime, formatLocalDate } from '../../../utils/date';
import { errorMessage } from '../../../utils/errorMessage';
import { formatStatusLabel } from '../../../utils/formatters';
import type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoardRoom,
  HousekeepingTask,
  UpdateHousekeepingTaskRequest,
} from '../../../types/housekeeping.types';
import type { RoomStatusUpdateInput } from '../../../types/room.types';
import {
  useCreateHousekeepingTask,
  useHousekeepingBoard,
  useSyncRoomStatuses,
  useUpdateHousekeepingTask,
} from '../hooks/useHousekeepingQueries';
import { useUpdateRoomStatus } from '../../rooms/hooks/useRoomQueries';
import { roomNeedsAttention } from '../housekeepingConfig';
import BoardView, { EMPTY_BOARD_FILTERS, type BoardFilters } from './BoardView';
import TasksView, { type TaskQuickFilter } from './TasksView';
import MaintenanceTab from './MaintenanceTab';
import NewTaskDialog from './NewTaskDialog';
import TaskEditDialog from './TaskEditDialog';
import RoomDetailDrawer from './RoomDetailDrawer';
import RoomStatusUpdateDialog from './RoomStatusUpdateDialog';
import NewTicketDialog from './NewTicketDialog';
import { useCreateMaintenanceTicket } from '../hooks/useMaintenanceQueries';
import type { HousekeepingActionContext, HousekeepingActionHandlers } from './RoomTaskCard';

interface Snack {
  severity: 'success' | 'error' | 'info';
  message: string;
}

export default function HousekeepingPage() {
  const { user, hasPermission } = useAuth();
  const confirm = useConfirm();
  const canViewMaintenance = hasPermission('maintenance:read') || hasPermission('maintenance:manage');
  const canWriteMaintenance =
    hasPermission('maintenance:write') || hasPermission('maintenance:manage');
  const canUpdate = hasPermission('housekeeping:update') || hasPermission('housekeeping:manage');
  const canCreate = hasPermission('housekeeping:create') || hasPermission('housekeeping:manage');
  const canSyncStatuses = hasPermission('rooms:update') || hasPermission('rooms:manage');
  const currentUserId = user?.id ? Number(user.id) : undefined;

  const [tab, setTab] = useState(0);
  const [taskQuick, setTaskQuick] = useState<TaskQuickFilter>('open');
  const [boardFilters, setBoardFilters] = useState<BoardFilters>(EMPTY_BOARD_FILTERS);
  const [snack, setSnack] = useState<Snack | null>(null);
  const [newTaskRoom, setNewTaskRoom] = useState<HousekeepingBoardRoom | null | undefined>(undefined);
  const [editTask, setEditTask] = useState<HousekeepingTask | null>(null);
  const [detailRoom, setDetailRoom] = useState<HousekeepingBoardRoom | null>(null);
  const [statusRoom, setStatusRoom] = useState<HousekeepingBoardRoom | null>(null);
  const [ticketRoom, setTicketRoom] = useState<HousekeepingBoardRoom | null | undefined>(undefined);

  const boardQuery = useHousekeepingBoard();
  const createTask = useCreateHousekeepingTask();
  const updateTask = useUpdateHousekeepingTask();
  const syncStatuses = useSyncRoomStatuses();
  const updateRoomStatus = useUpdateRoomStatus();
  const createTicket = useCreateMaintenanceTicket();

  const rooms = useMemo(() => boardQuery.data?.rooms ?? [], [boardQuery.data]);
  const roomById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);

  const stats = useMemo(() => {
    const count = (predicate: (room: HousekeepingBoardRoom) => boolean) =>
      rooms.filter(predicate).length;
    return {
      needsCleaning: count((room) => room.status === 'dirty' || room.status === 'reserved_dirty'),
      inProgress: count(
        (room) => room.status === 'cleaning' || room.open_task?.status === 'in_progress',
      ),
      unassigned: count((room) => Boolean(room.open_task && !room.open_task.assigned_to)),
      blocked: count((room) => room.status === 'maintenance' || room.status === 'out_of_order'),
      ready: count((room) => room.status === 'available'),
      attention: count(roomNeedsAttention),
    };
  }, [rooms]);

  const notify = (severity: Snack['severity'], message: string) =>
    setSnack({ severity, message });

  const busyTaskId =
    updateTask.isPending && updateTask.variables ? Number(updateTask.variables.taskId) : undefined;

  const patchTask = async (
    task: HousekeepingTask,
    input: UpdateHousekeepingTaskRequest,
    success: string,
  ) => {
    try {
      await updateTask.mutateAsync({ taskId: task.id, input });
      notify('success', success);
    } catch (err) {
      notify('error', errorMessage(err, 'Task update failed'));
    }
  };

  const actionContext: HousekeepingActionContext = {
    canCreate,
    canUpdate,
    canUpdateRoomStatus: canSyncStatuses,
    canWriteMaintenance,
    currentUserId,
    busyTaskId,
  };

  const actions: HousekeepingActionHandlers = {
    onStartTask: (task) =>
      void patchTask(task, { status: 'in_progress' }, `Room ${task.room_number} — task started.`),
    onCompleteTask: (task) => {
      void (async () => {
        const releasesRoom =
          task.task_type === 'cleaning' || task.task_type === 'checkout_clean';
        const ok = await confirm({
          title: 'Complete task?',
          message: releasesRoom
            ? `Room ${task.room_number} will be marked clean and released for sale.`
            : `The ${formatStatusLabel(task.task_type)} task on room ${task.room_number} will be marked completed.`,
          confirmText: 'Complete',
          severity: 'info',
        });
        if (ok) {
          await patchTask(task, { status: 'completed' }, `Room ${task.room_number} — task completed.`);
        }
      })();
    },
    onAssignMe: (task) => {
      if (!currentUserId) return;
      void patchTask(
        task,
        { assigned_to: currentUserId },
        `Room ${task.room_number} — task assigned to you.`,
      );
    },
    onEditTask: (task) => setEditTask(task),
    onVoidTask: (task) => {
      void (async () => {
        const ok = await confirm({
          title: 'Void this task?',
          message: `The ${formatStatusLabel(task.task_type)} task on room ${task.room_number} will be cancelled. The room keeps its current status.`,
          confirmText: 'Void task',
          severity: 'warning',
        });
        if (ok) {
          await patchTask(task, { status: 'void' }, `Room ${task.room_number} — task voided.`);
        }
      })();
    },
    onNewTask: (room) => setNewTaskRoom(room),
    onViewRoom: (room) => setDetailRoom(room),
    onUpdateRoomStatus: (room) => setStatusRoom(room),
    onReportMaintenance: (room) => setTicketRoom(room),
  };

  const handleCreateTask = async (input: CreateHousekeepingTaskRequest) => {
    await createTask.mutateAsync(input);
    const room = roomById.get(input.room_id);
    notify('success', `Task created for room ${room?.room_number ?? input.room_id}.`);
  };

  const handleEditTask = async (taskId: number, input: UpdateHousekeepingTaskRequest) => {
    await updateTask.mutateAsync({ taskId, input });
    notify('success', 'Task updated.');
  };

  const handleRoomStatus = async (roomId: number, input: RoomStatusUpdateInput) => {
    await updateRoomStatus.mutateAsync({ roomId, data: input });
    boardQuery.refetch();
    notify('success', `Room ${roomById.get(roomId)?.room_number ?? roomId} → ${formatStatusLabel(input.status)}.`);
  };

  const goToBoardFilter = (patch: Partial<BoardFilters>) => {
    setBoardFilters({ ...EMPTY_BOARD_FILTERS, ...patch });
    setTab(0);
  };

  const statItems = [
    {
      key: 'attention',
      label: 'Needs attention',
      value: stats.attention,
      color: 'warning.main',
      onClick: () => goToBoardFilter({ attentionOnly: true }),
      active: tab === 0 && boardFilters.attentionOnly,
    },
    {
      key: 'needsCleaning',
      label: 'Needs cleaning',
      value: stats.needsCleaning,
      color: 'warning.main',
      onClick: () => goToBoardFilter({ status: 'dirty' }),
      active: tab === 0 && boardFilters.status === 'dirty',
    },
    {
      key: 'inProgress',
      label: 'In progress',
      value: stats.inProgress,
      color: 'primary.main',
      onClick: () => goToBoardFilter({ status: 'cleaning' }),
      active: tab === 0 && boardFilters.status === 'cleaning',
    },
    {
      key: 'unassigned',
      label: 'Unassigned tasks',
      value: stats.unassigned,
      color: 'info.main',
      onClick: () => {
        setTaskQuick('unassigned');
        setTab(1);
      },
      active: tab === 1 && taskQuick === 'unassigned',
    },
    {
      key: 'blocked',
      label: 'Blocked rooms',
      value: stats.blocked,
      color: 'error.main',
      onClick: () => goToBoardFilter({ status: 'maintenance' }),
      active: tab === 0 && boardFilters.status === 'maintenance',
    },
    {
      key: 'ready',
      label: 'Ready',
      value: stats.ready,
      color: 'success.main',
      onClick: () => goToBoardFilter({ status: 'available' }),
      active: tab === 0 && boardFilters.status === 'available',
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: 'auto' }}>
      <PageHeader
        kicker={`Operations · ${formatLocalDate()}`}
        title="Housekeeping"
        subtitle={
          boardQuery.data
            ? `${rooms.length} rooms · ${stats.attention} need attention · updated ${formatHotelDateTime(new Date(boardQuery.dataUpdatedAt).toISOString())}`
            : 'Room status and task board'
        }
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Tooltip title="Refresh board">
              <span>
                <IconButton
                  aria-label="Refresh housekeeping board"
                  onClick={() => boardQuery.refetch()}
                  disabled={boardQuery.isFetching}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {canSyncStatuses ? (
              <Button
                variant="outlined"
                size="small"
                startIcon={<SyncIcon />}
                disabled={syncStatuses.isPending}
                onClick={() => syncStatuses.mutate()}
              >
                Sync statuses
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setNewTaskRoom(null)}
              >
                New task
              </Button>
            ) : null}
          </Stack>
        }
      />

      <Stack spacing={2.5}>
        <StatStrip items={statItems} />

        {boardQuery.error ? (
          <Alert
            severity="error"
            action={<Button onClick={() => boardQuery.refetch()}>Retry</Button>}
          >
            {errorMessage(boardQuery.error, 'Failed to load the housekeeping board.')}
          </Alert>
        ) : null}

        {syncStatuses.data ? (
          <Alert
            severity={syncStatuses.data.synced_count > 0 ? 'success' : 'info'}
            onClose={() => syncStatuses.reset()}
          >
            {syncStatuses.data.message}
            {syncStatuses.data.changes.length > 0
              ? ` — ${syncStatuses.data.changes
                  .map(
                    (change) =>
                      `${change.room_number}: ${formatStatusLabel(change.old_status)} → ${formatStatusLabel(change.new_status)}`,
                  )
                  .join(', ')}`
              : ''}
          </Alert>
        ) : null}
        {syncStatuses.error ? (
          <Alert severity="error">
            {errorMessage(syncStatuses.error, 'Status sync failed')}
          </Alert>
        ) : null}

        <Tabs
          value={tab}
          onChange={(_event, value: number) => setTab(value)}
          aria-label="Housekeeping views"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Board" {...getTabA11yProps(0, 'housekeeping')} />
          <Tab label="Tasks" {...getTabA11yProps(1, 'housekeeping')} />
          {canViewMaintenance ? (
            <Tab label="Maintenance" {...getTabA11yProps(2, 'housekeeping')} />
          ) : null}
        </Tabs>

        <TabPanel value={tab} index={0} idPrefix="housekeeping">
          <BoardView
            rooms={rooms}
            isLoading={boardQuery.isLoading}
            filters={boardFilters}
            onFiltersChange={setBoardFilters}
            actions={actions}
            {...actionContext}
          />
        </TabPanel>
        <TabPanel value={tab} index={1} idPrefix="housekeeping">
          <TasksView
            roomById={roomById}
            actions={actions}
            quick={taskQuick}
            onQuickChange={setTaskQuick}
            {...actionContext}
          />
        </TabPanel>
        {canViewMaintenance ? (
          <TabPanel value={tab} index={2} idPrefix="housekeeping">
            <MaintenanceTab canWrite={canWriteMaintenance} onNotify={notify} />
          </TabPanel>
        ) : null}
      </Stack>

      <NewTaskDialog
        open={newTaskRoom !== undefined}
        rooms={rooms}
        initialRoom={newTaskRoom ?? null}
        onClose={() => setNewTaskRoom(undefined)}
        onSubmit={handleCreateTask}
      />
      <TaskEditDialog
        open={Boolean(editTask)}
        task={editTask}
        onClose={() => setEditTask(null)}
        onSubmit={handleEditTask}
      />
      <RoomDetailDrawer
        room={detailRoom}
        open={Boolean(detailRoom)}
        onClose={() => setDetailRoom(null)}
        actions={actions}
        {...actionContext}
      />
      <RoomStatusUpdateDialog
        open={Boolean(statusRoom)}
        room={statusRoom}
        onClose={() => setStatusRoom(null)}
        onSubmit={handleRoomStatus}
      />
      <NewTicketDialog
        open={ticketRoom !== undefined}
        initialRoom={ticketRoom ?? null}
        onClose={() => setTicketRoom(undefined)}
        onSubmit={async (input) => {
          await createTicket.mutateAsync(input);
          notify('success', 'Maintenance ticket created.');
        }}
      />

      <Snackbar
        open={Boolean(snack)}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        message={snack?.message}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
