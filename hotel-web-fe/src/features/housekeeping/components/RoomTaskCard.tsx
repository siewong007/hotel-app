import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import BuildIcon from '@mui/icons-material/Build';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EditIcon from '@mui/icons-material/Edit';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useState } from 'react';
import StatusChip from '../../../components/common/StatusChip';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type {
  HousekeepingBoardRoom,
  HousekeepingTask,
} from '../../../types/housekeeping.types';
import {
  canCreateTaskForStatus,
  isTaskOverdue,
  PRIORITY_META,
  roomStatusMeta,
  TASK_TYPE_META,
} from '../housekeepingConfig';
import type { HousekeepingPriority } from '../../../types/housekeeping.types';

/** Callbacks every housekeeping surface (board card, task row, drawer) needs.
 * The page owns the mutations and hands one object down. */
export interface HousekeepingActionHandlers {
  onStartTask: (task: HousekeepingTask) => void;
  onCompleteTask: (task: HousekeepingTask) => void;
  onAssignMe: (task: HousekeepingTask) => void;
  onEditTask: (task: HousekeepingTask) => void;
  onVoidTask: (task: HousekeepingTask) => void;
  onNewTask: (room: HousekeepingBoardRoom) => void;
  onViewRoom: (room: HousekeepingBoardRoom) => void;
  onUpdateRoomStatus: (room: HousekeepingBoardRoom) => void;
  onReportMaintenance: (room: HousekeepingBoardRoom) => void;
}

export interface HousekeepingActionContext {
  canCreate: boolean;
  canUpdate: boolean;
  canUpdateRoomStatus: boolean;
  canWriteMaintenance: boolean;
  currentUserId?: number;
  /** Task id currently being mutated, so only that row's actions disable. */
  busyTaskId?: number;
}

interface RoomTaskCardProps extends HousekeepingActionContext {
  room: HousekeepingBoardRoom;
  actions: HousekeepingActionHandlers;
}

function RoomTaskCard({ room, actions, ...ctx }: RoomTaskCardProps) {
  const { t } = useTranslation('housekeeping');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const task = room.open_task;
  const meta = roomStatusMeta(room.status);
  const busy = ctx.busyTaskId === task?.id;
  const overdue = task ? isTaskOverdue(task) : false;
  const showAddTask = !task && canCreateTaskForStatus(room.status) && ctx.canCreate;
  const typeTone = task ? TASK_TYPE_META[task.task_type]?.tone : undefined;

  const closeMenu = () => setMenuAnchor(null);
  const menuItem = (handler?: (task: HousekeepingTask) => void) => () => {
    closeMenu();
    if (task && handler) handler(task);
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: overdue ? 'error.light' : 'divider',
        borderRadius: 1,
        p: 1.25,
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap>
              {t('card.roomN', { number: room.room_number })}
            </Typography>
            <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>
              {room.room_type}
              {room.floor != null ? ` · ${t('rooms:header.floorN', { floor: room.floor })}` : ''}
            </Typography>
          </Box>
          <StatusChip status={room.status} domain="room" tone={meta.tone} />
        </Stack>

        {task ? (
          <>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
              <Chip
                size="small"
                variant="outlined"
                color={typeTone === 'neutral' || !typeTone ? 'default' : typeTone}
                label={statusLabel(t, 'task_type', task.task_type)}
              />
              <StatusChip
                status={task.priority}
                label={t('card.priorityPrefix', { name: statusLabel(t, 'priority', task.priority) })}
                tone={PRIORITY_META[task.priority as HousekeepingPriority]?.tone ?? 'neutral'}
              />
              <StatusChip status={task.status} domain="housekeeping" />
              {task.assigned_to_name ? (
                <Chip size="small" icon={<AssignmentIndIcon />} label={task.assigned_to_name} />
              ) : (
                <Chip size="small" variant="outlined" label={t('card.unassigned')} />
              )}
              {task.scheduled_date ? (
                <Chip
                  size="small"
                  color={overdue ? 'error' : 'default'}
                  variant={overdue ? 'filled' : 'outlined'}
                  icon={overdue ? <EventBusyIcon /> : undefined}
                  label={overdue ? t('card.overdue', { date: task.scheduled_date }) : t('card.due', { date: task.scheduled_date })}
                />
              ) : null}
            </Stack>
            {task.notes ? (
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {task.notes}
              </Typography>
            ) : null}
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              {ctx.canUpdate && task.status === 'pending' ? (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  disabled={busy}
                  aria-label={t('card.startAria', { type: statusLabel(t, 'task_type', task.task_type), room: room.room_number })}
                  onClick={() => actions.onStartTask(task)}
                >
                  {t('card.start')}
                </Button>
              ) : null}
              {ctx.canUpdate && task.status === 'in_progress' ? (
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<CheckCircleIcon />}
                  disabled={busy}
                  aria-label={t('card.completeAria', { type: statusLabel(t, 'task_type', task.task_type), room: room.room_number })}
                  onClick={() => actions.onCompleteTask(task)}
                >
                  {t('card.complete')}
                </Button>
              ) : null}
              {ctx.canUpdate && !task.assigned_to && ctx.currentUserId ? (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AssignmentIndIcon />}
                  disabled={busy}
                  aria-label={t('card.assignAria', { room: room.room_number })}
                  onClick={() => actions.onAssignMe(task)}
                >
                  {t('card.assignMe')}
                </Button>
              ) : null}
              <Tooltip title={t('card.moreActions')}>
                <IconButton
                  size="small"
                  aria-label={t('card.moreActionsRoom', { room: room.room_number })}
                  aria-haspopup="menu"
                  onClick={(event) => setMenuAnchor(event.currentTarget)}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </>
        ) : (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            {showAddTask ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                aria-label={t('card.addTaskAria', { room: room.room_number })}
                onClick={() => actions.onNewTask(room)}
              >
                {t('card.addTask')}
              </Button>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
                {t('card.noOpenTask')}
              </Typography>
            )}
            <Tooltip title={t('card.moreActions')}>
              <IconButton
                size="small"
                aria-label={t('card.moreActionsRoom', { room: room.room_number })}
                aria-haspopup="menu"
                onClick={(event) => setMenuAnchor(event.currentTarget)}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={() => {
            closeMenu();
            actions.onViewRoom(room);
          }}
        >
          <ListItemIcon>
            <InfoOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('card.menuRoomDetails')}</ListItemText>
        </MenuItem>
        {task && ctx.canUpdate ? (
          <MenuItem onClick={menuItem(actions.onEditTask)}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('card.menuEditTask')}</ListItemText>
          </MenuItem>
        ) : null}
        {task?.assigned_to && ctx.canUpdate ? (
          <MenuItem onClick={menuItem(actions.onEditTask)}>
            <ListItemIcon>
              <PersonOffIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('card.menuReassign')}</ListItemText>
          </MenuItem>
        ) : null}
        {task && task.status !== 'completed' && task.status !== 'void' && ctx.canUpdate ? (
          <MenuItem onClick={menuItem(actions.onVoidTask)}>
            <ListItemIcon>
              <EventBusyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('card.menuVoidTask')}</ListItemText>
          </MenuItem>
        ) : null}
        <Divider />
        {ctx.canUpdateRoomStatus ? (
          <MenuItem
            onClick={() => {
              closeMenu();
              actions.onUpdateRoomStatus(room);
            }}
          >
            <ListItemIcon>
              <SwapHorizIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('card.menuUpdateStatus')}</ListItemText>
          </MenuItem>
        ) : null}
        {ctx.canWriteMaintenance ? (
          <MenuItem
            onClick={() => {
              closeMenu();
              actions.onReportMaintenance(room);
            }}
          >
            <ListItemIcon>
              <BuildIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('card.menuReportMaintenance')}</ListItemText>
          </MenuItem>
        ) : null}
      </Menu>
    </Box>
  );
}

export default RoomTaskCard;
