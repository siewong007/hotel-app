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
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '../../../router';
import PageHeader from '../../../components/common/PageHeader';
import StatStrip from '../../../components/common/StatStrip';
import { getTabA11yProps, TabPanel } from '../../../components/common/TabPanel';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { formatHotelDateTime, formatLocalDate } from '../../../utils/date';
import { errorMessage } from '../../../utils/errorMessage';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
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
  const { t } = useTranslation('housekeeping');
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

  // Deep links: ?tab=tasks|maintenance picks the tab (mobile quick actions);
  // ?create=task|ticket opens the matching dialog directly.
  const [pageSearchParams, setPageSearchParams] = useSearchParams();
  const routedTab = pageSearchParams.get('tab') || '';
  const routedCreate = pageSearchParams.get('create') || '';
  useEffect(() => {
    if (routedTab === 'tasks') setTab(1);
    else if (routedTab === 'maintenance' && canViewMaintenance) setTab(2);
  }, [routedTab, canViewMaintenance]);
  useEffect(() => {
    if (!routedCreate) return;
    if (routedCreate === 'task' && canCreate) setNewTaskRoom(null);
    else if (routedCreate === 'ticket' && canWriteMaintenance) setTicketRoom(null);
    const next = new URLSearchParams(pageSearchParams);
    next.delete('create');
    setPageSearchParams(next, { replace: true });
  }, [routedCreate, canCreate, canWriteMaintenance, pageSearchParams, setPageSearchParams]);

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
      notify('error', errorMessage(err, t('errors.taskUpdate')));
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
      void patchTask(task, { status: 'in_progress' }, t('success.taskStarted', { room: task.room_number })),
    onCompleteTask: (task) => {
      void (async () => {
        const releasesRoom =
          task.task_type === 'cleaning' || task.task_type === 'checkout_clean';
        const ok = await confirm({
          title: t('confirm.completeTitle'),
          message: releasesRoom
            ? t('confirm.completeRelease', { room: task.room_number })
            : t('confirm.completeOther', {
                type: statusLabel(t, 'task_type', task.task_type),
                room: task.room_number,
              }),
          confirmText: t('confirm.completeConfirm'),
          severity: 'info',
        });
        if (ok) {
          await patchTask(task, { status: 'completed' }, t('success.taskCompleted', { room: task.room_number }));
        }
      })();
    },
    onAssignMe: (task) => {
      if (!currentUserId) return;
      void patchTask(
        task,
        { assigned_to: currentUserId },
        t('success.taskAssigned', { room: task.room_number }),
      );
    },
    onEditTask: (task) => setEditTask(task),
    onVoidTask: (task) => {
      void (async () => {
        const ok = await confirm({
          title: t('confirm.voidTitle'),
          message: t('confirm.voidBody', {
            type: statusLabel(t, 'task_type', task.task_type),
            room: task.room_number,
          }),
          confirmText: t('confirm.voidConfirm'),
          severity: 'warning',
        });
        if (ok) {
          await patchTask(task, { status: 'void' }, t('success.taskVoided', { room: task.room_number }));
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
    notify('success', t('success.taskCreated', { room: room?.room_number ?? input.room_id }));
  };

  const handleEditTask = async (taskId: number, input: UpdateHousekeepingTaskRequest) => {
    await updateTask.mutateAsync({ taskId, input });
    notify('success', t('success.taskUpdated'));
  };

  const handleRoomStatus = async (roomId: string | number, input: RoomStatusUpdateInput) => {
    await updateRoomStatus.mutateAsync({ roomId, data: input });
    boardQuery.refetch();
    notify('success', t('success.roomStatus', {
      room: roomById.get(Number(roomId))?.room_number ?? roomId,
      status: statusLabel(t, 'room', input.status),
    }));
  };

  const goToBoardFilter = (patch: Partial<BoardFilters>) => {
    setBoardFilters({ ...EMPTY_BOARD_FILTERS, ...patch });
    setTab(0);
  };

  const statItems = [
    {
      key: 'attention',
      label: t('page.statAttention'),
      value: stats.attention,
      color: 'warning.main',
      onClick: () => goToBoardFilter({ attentionOnly: true }),
      active: tab === 0 && boardFilters.attentionOnly,
    },
    {
      key: 'needsCleaning',
      label: t('page.statNeedsCleaning'),
      value: stats.needsCleaning,
      color: 'warning.main',
      onClick: () => goToBoardFilter({ status: 'dirty' }),
      active: tab === 0 && boardFilters.status === 'dirty',
    },
    {
      key: 'inProgress',
      label: t('page.statInProgress'),
      value: stats.inProgress,
      color: 'primary.main',
      onClick: () => goToBoardFilter({ status: 'cleaning' }),
      active: tab === 0 && boardFilters.status === 'cleaning',
    },
    {
      key: 'unassigned',
      label: t('page.statUnassigned'),
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
      label: t('page.statBlocked'),
      value: stats.blocked,
      color: 'error.main',
      onClick: () => goToBoardFilter({ status: 'maintenance' }),
      active: tab === 0 && boardFilters.status === 'maintenance',
    },
    {
      key: 'ready',
      label: t('page.statReady'),
      value: stats.ready,
      color: 'success.main',
      onClick: () => goToBoardFilter({ status: 'available' }),
      active: tab === 0 && boardFilters.status === 'available',
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: 'auto' }}>
      <PageHeader
        kicker={t('page.kicker', { date: formatLocalDate() })}
        title={t('title')}
        subtitle={
          boardQuery.data
            ? t('page.subtitle', {
                rooms: rooms.length,
                attention: stats.attention,
                updated: formatHotelDateTime(new Date(boardQuery.dataUpdatedAt).toISOString()),
              })
            : t('page.subtitleFallback')
        }
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Tooltip title={t('page.refreshTooltip')}>
              <span>
                <IconButton
                  aria-label={t('page.refreshAria')}
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
                {t('page.syncStatuses')}
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                variant="contained"
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setNewTaskRoom(null)}
              >
                {t('page.newTask')}
              </Button>
            ) : null}
          </Stack>
        }
        mobilePrimaryAction={
          canCreate ? (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setNewTaskRoom(null)}
            >
              New task
            </Button>
          ) : null
        }
        overflowActions={[
          {
            id: 'refresh-board',
            label: 'Refresh board',
            icon: <RefreshIcon fontSize="small" />,
            onClick: () => boardQuery.refetch(),
            disabled: boardQuery.isFetching,
          },
          {
            id: 'sync-statuses',
            label: 'Sync statuses',
            icon: <SyncIcon fontSize="small" />,
            onClick: () => syncStatuses.mutate(),
            disabled: syncStatuses.isPending,
            hidden: !canSyncStatuses,
          },
        ]}
      />

      <Stack spacing={2.5}>
        <StatStrip items={statItems} />

        {boardQuery.error ? (
          <Alert
            severity="error"
            action={<Button onClick={() => boardQuery.refetch()}>{t('common:state.retry')}</Button>}
          >
            {errorMessage(boardQuery.error, t('errors.loadBoard'))}
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
                      `${change.room_number}: ${statusLabel(t, 'room', change.old_status)} → ${statusLabel(t, 'room', change.new_status)}`,
                  )
                  .join(', ')}`
              : ''}
          </Alert>
        ) : null}
        {syncStatuses.error ? (
          <Alert severity="error">
            {errorMessage(syncStatuses.error, t('errors.syncFailed'))}
          </Alert>
        ) : null}

        <Tabs
          value={tab}
          onChange={(_event, value: number) => setTab(value)}
          aria-label={t('page.tabsAria')}
          variant="scrollable"
          scrollButtons={false}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label={t('page.tabBoard')} {...getTabA11yProps(0, 'housekeeping')} />
          <Tab label={t('page.tabTasks')} {...getTabA11yProps(1, 'housekeeping')} />
          {canViewMaintenance ? (
            <Tab label={t('page.tabMaintenance')} {...getTabA11yProps(2, 'housekeeping')} />
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
          notify('success', t('success.ticketCreated'));
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
