import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Alert from '@mui/material/Alert';
import type { ReactNode } from 'react';
import { LogoLoader } from '../../../components';
import StatusChip from '../../../components/common/StatusChip';
import { formatHotelDate, formatHotelDateTime } from '../../../utils/date';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type { HousekeepingBoardRoom } from '../../../types/housekeeping.types';
import {
  isOpenTask,
  isTaskOverdue,
  PRIORITY_META,
  roomStatusMeta,
} from '../housekeepingConfig';
import { useHousekeepingTasks } from '../hooks/useHousekeepingQueries';
import { useRoomDetailedStatus, useRoomHistory } from '../../rooms/hooks/useRoomQueries';
import type { HousekeepingActionContext, HousekeepingActionHandlers } from './RoomTaskCard';
import type { HousekeepingPriority } from '../../../types/housekeeping.types';

interface RoomDetailDrawerProps extends HousekeepingActionContext {
  room: HousekeepingBoardRoom | null;
  open: boolean;
  onClose: () => void;
  actions: HousekeepingActionHandlers;
}

function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  );
}

export default function RoomDetailDrawer({
  room,
  open,
  onClose,
  actions,
  ...ctx
}: RoomDetailDrawerProps) {
  const { t } = useTranslation('housekeeping');
  const roomId = room?.id;
  const detailQuery = useRoomDetailedStatus(roomId, open);
  const historyQuery = useRoomHistory(roomId, open);
  const tasksQuery = useHousekeepingTasks({ room_id: roomId, page_size: 20 }, open);

  if (!room) return null;

  const detail = detailQuery.data;
  const tasks = tasksQuery.data?.items ?? [];
  const openTasks = tasks.filter(isOpenTask);
  const recentTasks = tasks.filter((task) => !isOpenTask(task)).slice(0, 5);
  const history = (historyQuery.data ?? []).slice(0, 8);
  const busyTaskId = ctx.busyTaskId;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 420 } } } }}
      aria-label={t('drawer.aria', { number: room.room_number })}
    >
      <Stack spacing={2.5} sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h6" component="h2">
              {t('card.roomN', { number: room.room_number })}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {detail?.room_type ?? room.room_type}
              {room.floor != null ? ` · ${t('rooms:header.floorN', { floor: room.floor })}` : ''}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label={t('drawer.closeAria')} size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <StatusChip status={room.status} domain="room" tone={roomStatusMeta(room.status).tone} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {roomStatusMeta(room.status).hintKey ? t(roomStatusMeta(room.status).hintKey) : ''}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {ctx.canCreate ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => actions.onNewTask(room)}
            >
              {t('drawer.newTask')}
            </Button>
          ) : null}
          {ctx.canUpdateRoomStatus ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SwapHorizIcon />}
              onClick={() => actions.onUpdateRoomStatus(room)}
            >
              {t('drawer.updateStatus')}
            </Button>
          ) : null}
          {ctx.canWriteMaintenance ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<BuildIcon />}
              onClick={() => actions.onReportMaintenance(room)}
            >
              {t('drawer.reportMaintenance')}
            </Button>
          ) : null}
        </Stack>

        <Divider />

        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            {t('drawer.openTasks')}
          </Typography>
          {tasksQuery.isLoading ? (
            <LogoLoader variant="inline" />
          ) : openTasks.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('drawer.noOpenTasksBody')}
            </Typography>
          ) : (
            <Stack spacing={1.25}>
              {openTasks.map((task) => {
                const busy = busyTaskId === task.id;
                const overdue = isTaskOverdue(task);
                return (
                  <Box
                    key={task.id}
                    sx={{
                      border: '1px solid',
                      borderColor: overdue ? 'error.light' : 'divider',
                      borderRadius: 1,
                      p: 1.25,
                    }}
                  >
                    <Stack spacing={0.75}>
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                        <Chip size="small" variant="outlined" label={statusLabel(t, 'task_type', task.task_type)} />
                        <StatusChip
                          status={task.priority}
                          domain="priority"
                          tone={
                            PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'
                          }
                        />
                        <StatusChip status={task.status} domain="housekeeping" />
                        {task.assigned_to_name ? (
                          <Chip size="small" icon={<AssignmentIndIcon />} label={task.assigned_to_name} />
                        ) : (
                          <Chip size="small" variant="outlined" label={t('card.unassigned')} />
                        )}
                      </Stack>
                      {task.scheduled_date ? (
                        <Typography
                          variant="caption"
                          sx={{ color: overdue ? 'error.main' : 'text.secondary' }}
                        >
                          {overdue ? t('drawer.overduePrefix') : t('drawer.scheduledPrefix')}
                          {formatHotelDate(task.scheduled_date)}
                        </Typography>
                      ) : null}
                      {task.notes ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {task.notes}
                        </Typography>
                      ) : null}
                      {ctx.canUpdate ? (
                        <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {task.status === 'pending' ? (
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<PlayArrowIcon />}
                              disabled={busy}
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
                              onClick={() => actions.onCompleteTask(task)}
                            >
                              {t('card.complete')}
                            </Button>
                          ) : null}
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={busy}
                            onClick={() => actions.onEditTask(task)}
                          >
                            {t('common:actions.edit')}
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<EventBusyIcon />}
                            disabled={busy}
                            onClick={() => actions.onVoidTask(task)}
                          >
                            {t('common:actions.void')}
                          </Button>
                        </Stack>
                      ) : null}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>

        {detailQuery.isLoading ? (
          <LogoLoader variant="inline" />
        ) : detail ? (
          <>
            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('drawer.statusDetails')}
              </Typography>
              <DetailRow
                label={t('drawer.reservedWindow')}
                value={
                  detail.reserved_start_date
                    ? `${formatHotelDate(detail.reserved_start_date)} – ${formatHotelDate(detail.reserved_end_date)}`
                    : undefined
                }
              />
              <DetailRow
                label={t('drawer.maintenanceWindow')}
                value={
                  detail.maintenance_start_date
                    ? `${formatHotelDate(detail.maintenance_start_date)} – ${formatHotelDate(detail.maintenance_end_date)}`
                    : undefined
                }
              />
              <DetailRow
                label={t('drawer.cleaningWindow')}
                value={
                  detail.cleaning_start_date
                    ? `${formatHotelDate(detail.cleaning_start_date)} – ${formatHotelDate(detail.cleaning_end_date)}`
                    : undefined
                }
              />
              <DetailRow label={t('drawer.statusNotes')} value={detail.status_notes} />
              <DetailRow label={t('drawer.maintenanceNotes')} value={detail.maintenance_notes} />
            </Stack>
          </>
        ) : detailQuery.error ? (
          <Alert severity="warning">{t('drawer.detailsUnavailable')}</Alert>
        ) : null}

        {detail?.recent_events?.length ? (
          <>
            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('drawer.recentEvents')}
              </Typography>
              {detail.recent_events.slice(0, 5).map((event) => (
                <Stack key={event.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">
                    {statusLabel(t, 'room_event', event.event_type)} · {statusLabel(t, 'room', event.status)}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {formatHotelDateTime(event.created_at)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        ) : null}

        {recentTasks.length > 0 ? (
          <>
            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('drawer.recentTasks')}
              </Typography>
              {recentTasks.map((task) => (
                <Stack key={task.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">
                    {statusLabel(t, 'task_type', task.task_type)} · {statusLabel(t, 'housekeeping', task.status)}
                    {task.assigned_to_name ? ` · ${task.assigned_to_name}` : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {task.completed_at
                      ? formatHotelDateTime(task.completed_at)
                      : formatHotelDateTime(task.updated_at)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        ) : null}

        {history.length > 0 ? (
          <>
            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('drawer.statusHistory')}
              </Typography>
              {history.map((entry) => (
                <Stack key={entry.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">
                    {entry.from_status ? `${statusLabel(t, 'room', entry.from_status)} → ` : ''}
                    {statusLabel(t, 'room', entry.to_status)}
                    {entry.changed_by_name ? ` · ${entry.changed_by_name}` : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {formatHotelDateTime(entry.created_at)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        ) : null}
      </Stack>
    </Drawer>
  );
}
