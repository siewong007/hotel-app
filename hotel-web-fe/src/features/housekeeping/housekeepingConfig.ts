/**
 * Single source of truth for housekeeping domain metadata: lane order, tones,
 * priority ranks, labels, and the operational rules the UI mirrors from the
 * backend (`services/housekeeping.rs`, `room_status_transitions`). Anything a
 * card, filter, or dialog needs to know about a status lives here — not in
 * component-local switch statements.
 */
import type { StatusTone } from '../../components/common/StatusChip';
import { toHotelDateString } from '../../utils/date';
import { formatStatusLabel } from '../../utils/formatters';
import type {
  HousekeepingBoardRoom,
  HousekeepingPriority,
  HousekeepingTask,
  HousekeepingTaskStatus,
  HousekeepingTaskType,
} from '../../types/housekeeping.types';
import type {
  MaintenancePriority,
  MaintenanceStatus,
} from '../../types/maintenance.types';

// ---------------------------------------------------------------------------
// Room statuses (rooms.status CHECK constraint values)
// ---------------------------------------------------------------------------

export interface RoomStatusMeta {
  /** One-line operational meaning shown under lane headers / in the drawer. */
  hint: string;
  tone: StatusTone;
  /** True when the status demands action from housekeeping today. */
  attention: boolean;
  /** True when the room is blocked and cannot be sold. */
  blocked: boolean;
}

export const ROOM_STATUS_META: Record<string, RoomStatusMeta> = {
  reserved_dirty: {
    hint: 'Arrival expected — must be cleaned before check-in',
    tone: 'error',
    attention: true,
    blocked: false,
  },
  dirty: {
    hint: 'Needs cleaning',
    tone: 'warning',
    attention: true,
    blocked: false,
  },
  cleaning: {
    hint: 'Cleaning in progress',
    tone: 'primary',
    attention: true,
    blocked: false,
  },
  maintenance: {
    hint: 'Blocked by maintenance',
    tone: 'warning',
    attention: true,
    blocked: true,
  },
  out_of_order: {
    hint: 'Out of order — cannot be sold',
    tone: 'error',
    attention: true,
    blocked: true,
  },
  occupied: {
    hint: 'Guest in house',
    tone: 'info',
    attention: false,
    blocked: false,
  },
  reserved: {
    hint: 'Reserved — room ready for arrival',
    tone: 'info',
    attention: false,
    blocked: false,
  },
  available: {
    hint: 'Clean and ready to sell',
    tone: 'success',
    attention: false,
    blocked: false,
  },
};

/** Board lane order: work that needs doing first, blocked rooms next, passive
 * occupancy states last. */
export const ROOM_LANE_ORDER = [
  'reserved_dirty',
  'dirty',
  'cleaning',
  'maintenance',
  'out_of_order',
  'available',
  'reserved',
  'occupied',
] as const;

/** Room statuses a new housekeeping task may be raised against (mirrors the
 * board card rule in the legacy page). */
export const TASKABLE_ROOM_STATUSES = ['dirty', 'cleaning', 'reserved_dirty'] as const;

/** Legal room-status transitions — mirrors the `room_status_transitions` seed
 * in 0001_v1_baseline.sql, so manual status updates only offer moves the
 * database will accept. Booking-driven targets (occupied/reserved/
 * reserved_dirty/cleaning) are intentionally absent from MANUAL_STATUS_TARGETS
 * even where the table permits them. */
export const ROOM_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  available: ['dirty', 'maintenance', 'out_of_order'],
  occupied: ['available', 'dirty', 'maintenance'],
  reserved: ['available', 'dirty', 'maintenance'],
  dirty: ['available', 'maintenance'],
  cleaning: ['available', 'dirty', 'maintenance'],
  reserved_dirty: ['available', 'dirty', 'maintenance'],
  maintenance: ['available', 'dirty', 'out_of_order'],
  out_of_order: ['available', 'dirty', 'maintenance'],
};

export const roomStatusMeta = (status: string): RoomStatusMeta =>
  ROOM_STATUS_META[status] ?? {
    hint: '',
    tone: 'neutral',
    attention: false,
    blocked: false,
  };

// ---------------------------------------------------------------------------
// Task domain
// ---------------------------------------------------------------------------

export const TASK_TYPES: HousekeepingTaskType[] = [
  'cleaning',
  'checkout_clean',
  'inspection',
  'maintenance_followup',
];

export const TASK_TYPE_META: Record<string, { label: string; tone: StatusTone }> = {
  cleaning: { label: 'Cleaning', tone: 'info' },
  checkout_clean: { label: 'Checkout clean', tone: 'warning' },
  inspection: { label: 'Inspection', tone: 'secondary' },
  maintenance_followup: { label: 'Maintenance follow-up', tone: 'neutral' },
};

export const taskTypeLabel = (taskType: string): string =>
  TASK_TYPE_META[taskType]?.label ?? formatStatusLabel(taskType);

export const PRIORITIES: HousekeepingPriority[] = ['low', 'normal', 'high', 'urgent'];

export const PRIORITY_META: Record<HousekeepingPriority, { tone: StatusTone; rank: number }> = {
  urgent: { tone: 'error', rank: 0 },
  high: { tone: 'warning', rank: 1 },
  normal: { tone: 'info', rank: 2 },
  low: { tone: 'neutral', rank: 3 },
};

export const priorityRank = (priority: string | undefined): number =>
  PRIORITY_META[(priority ?? 'normal') as HousekeepingPriority]?.rank ?? 2;

/** Valid task transitions — mirrors `validate_status_transition` in
 * services/housekeeping.rs so the UI only ever offers legal moves. */
export const TASK_TRANSITIONS: Record<HousekeepingTaskStatus, HousekeepingTaskStatus[]> = {
  pending: ['in_progress', 'void'],
  in_progress: ['completed', 'void'],
  completed: [],
  void: [],
};

export const OPEN_TASK_STATUSES: HousekeepingTaskStatus[] = ['pending', 'in_progress'];

export const isOpenTask = (task: HousekeepingTask): boolean =>
  OPEN_TASK_STATUSES.includes(task.status);

// ---------------------------------------------------------------------------
// Maintenance tickets (shared vocabulary for the Maintenance tab)
// ---------------------------------------------------------------------------

export const MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  'open',
  'in_progress',
  'on_hold',
  'resolved',
  'closed',
];

export const MAINTENANCE_STATUS_META: Record<MaintenanceStatus, { tone: StatusTone }> = {
  open: { tone: 'warning' },
  in_progress: { tone: 'primary' },
  on_hold: { tone: 'neutral' },
  resolved: { tone: 'success' },
  closed: { tone: 'neutral' },
};

export const MAINTENANCE_PRIORITIES: MaintenancePriority[] = [
  'low',
  'medium',
  'high',
  'critical',
];

export const MAINTENANCE_PRIORITY_META: Record<MaintenancePriority, { tone: StatusTone }> = {
  critical: { tone: 'error' },
  high: { tone: 'warning' },
  medium: { tone: 'info' },
  low: { tone: 'neutral' },
};

/** Mirrors `validate_status_transition` in services/maintenance.rs. */
export const MAINTENANCE_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  open: ['in_progress', 'on_hold', 'closed'],
  in_progress: ['on_hold', 'resolved', 'closed'],
  on_hold: ['in_progress', 'closed'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

// ---------------------------------------------------------------------------
// Operational helpers
// ---------------------------------------------------------------------------

/** A room needs attention when its status demands action OR it carries an
 * open task (e.g. an inspection task on an occupied room). */
export const roomNeedsAttention = (room: HousekeepingBoardRoom): boolean =>
  roomStatusMeta(room.status).attention || Boolean(room.open_task && isOpenTask(room.open_task));

export const canCreateTaskForStatus = (status: string): boolean =>
  (TASKABLE_ROOM_STATUSES as readonly string[]).includes(status);

/** Scheduled earlier than the hotel business day and still open. */
export const isTaskOverdue = (task: HousekeepingTask): boolean =>
  Boolean(task.scheduled_date) &&
  task.scheduled_date! < toHotelDateString(new Date()) &&
  isOpenTask(task);

/** Numeric-aware room ordering (101 < 102 < 201 regardless of string form). */
export const compareRoomNumbers = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Urgency order inside a lane: task priority first, then room number. */
export const compareRoomsByUrgency = (
  a: HousekeepingBoardRoom,
  b: HousekeepingBoardRoom,
): number =>
  priorityRank(a.open_task?.priority) - priorityRank(b.open_task?.priority) ||
  compareRoomNumbers(a.room_number, b.room_number);
