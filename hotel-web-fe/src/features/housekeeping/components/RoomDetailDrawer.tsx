import {
  Box,
  Button,
  Chip,
  CircularProgress,
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
import StatusChip from '../../../components/common/StatusChip';
import { formatHotelDate, formatHotelDateTime } from '../../../utils/date';
import { formatStatusLabel } from '../../../utils/formatters';
import type { HousekeepingBoardRoom } from '../../../types/housekeeping.types';
import {
  isOpenTask,
  isTaskOverdue,
  PRIORITY_META,
  roomStatusMeta,
  taskTypeLabel,
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
      aria-label={`Room ${room.room_number} details`}
    >
      <Stack spacing={2.5} sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h6" component="h2">
              Room {room.room_number}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {detail?.room_type ?? room.room_type}
              {room.floor != null ? ` · Floor ${room.floor}` : ''}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close room details" size="small">
            <CloseIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <StatusChip status={room.status} tone={roomStatusMeta(room.status).tone} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {roomStatusMeta(room.status).hint}
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
              New task
            </Button>
          ) : null}
          {ctx.canUpdateRoomStatus ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SwapHorizIcon />}
              onClick={() => actions.onUpdateRoomStatus(room)}
            >
              Update status
            </Button>
          ) : null}
          {ctx.canWriteMaintenance ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<BuildIcon />}
              onClick={() => actions.onReportMaintenance(room)}
            >
              Report maintenance
            </Button>
          ) : null}
        </Stack>

        <Divider />

        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            Open tasks
          </Typography>
          {tasksQuery.isLoading ? (
            <CircularProgress size={20} />
          ) : openTasks.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No open housekeeping tasks for this room.
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
                        <Chip size="small" variant="outlined" label={taskTypeLabel(task.task_type)} />
                        <StatusChip
                          status={task.priority}
                          label={formatStatusLabel(task.priority)}
                          tone={
                            PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'
                          }
                        />
                        <StatusChip status={task.status} />
                        {task.assigned_to_name ? (
                          <Chip size="small" icon={<AssignmentIndIcon />} label={task.assigned_to_name} />
                        ) : (
                          <Chip size="small" variant="outlined" label="Unassigned" />
                        )}
                      </Stack>
                      {task.scheduled_date ? (
                        <Typography
                          variant="caption"
                          sx={{ color: overdue ? 'error.main' : 'text.secondary' }}
                        >
                          {overdue ? 'Overdue · ' : 'Scheduled · '}
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
                              onClick={() => actions.onCompleteTask(task)}
                            >
                              Complete
                            </Button>
                          ) : null}
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={busy}
                            onClick={() => actions.onEditTask(task)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<EventBusyIcon />}
                            disabled={busy}
                            onClick={() => actions.onVoidTask(task)}
                          >
                            Void
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
          <CircularProgress size={20} />
        ) : detail ? (
          <>
            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Status details
              </Typography>
              <DetailRow
                label="Reserved window"
                value={
                  detail.reserved_start_date
                    ? `${formatHotelDate(detail.reserved_start_date)} – ${formatHotelDate(detail.reserved_end_date)}`
                    : undefined
                }
              />
              <DetailRow
                label="Maintenance window"
                value={
                  detail.maintenance_start_date
                    ? `${formatHotelDate(detail.maintenance_start_date)} – ${formatHotelDate(detail.maintenance_end_date)}`
                    : undefined
                }
              />
              <DetailRow
                label="Cleaning window"
                value={
                  detail.cleaning_start_date
                    ? `${formatHotelDate(detail.cleaning_start_date)} – ${formatHotelDate(detail.cleaning_end_date)}`
                    : undefined
                }
              />
              <DetailRow label="Status notes" value={detail.status_notes} />
              <DetailRow label="Maintenance notes" value={detail.maintenance_notes} />
            </Stack>
          </>
        ) : detailQuery.error ? (
          <Alert severity="warning">Room details unavailable — you can still work the tasks above.</Alert>
        ) : null}

        {detail?.recent_events?.length ? (
          <>
            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Recent events
              </Typography>
              {detail.recent_events.slice(0, 5).map((event) => (
                <Stack key={event.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">
                    {formatStatusLabel(event.event_type)} · {formatStatusLabel(event.status)}
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
                Recent tasks
              </Typography>
              {recentTasks.map((task) => (
                <Stack key={task.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">
                    {taskTypeLabel(task.task_type)} · {formatStatusLabel(task.status)}
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
                Status history
              </Typography>
              {history.map((entry) => (
                <Stack key={entry.id} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
                  <Typography variant="body2">
                    {entry.from_status ? `${formatStatusLabel(entry.from_status)} → ` : ''}
                    {formatStatusLabel(entry.to_status)}
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
