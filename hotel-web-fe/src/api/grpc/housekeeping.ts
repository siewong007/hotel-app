// gRPC implementations of HousekeepingService / MaintenanceService methods —
// same signatures, same REST-shaped returns. See ./rooms.ts for conventions.

import { timestampFromDate } from '@bufbuild/protobuf/wkt';

import { housekeepingClient, maintenanceClient } from '../grpcClient';
import {
  nameId,
  nameIdString,
  roomName,
  taskName,
  ticketName,
  userName,
  tsToIso,
  gdateToString,
  stringToGdate,
  moneyToMajor,
  majorToMoney,
  decimalToNumber,
  numberToDecimal,
  enumToRest,
  restToEnum,
  valueToJson,
  jsonToValue,
} from './convert';
import {
  HousekeepingTaskType,
  HousekeepingTaskStatus,
  HousekeepingPriority,
  AssignableStaffScope,
} from '../../gen/hotel/housekeeping/v1/housekeeping_pb';
import {
  MaintenanceStatus,
  MaintenanceCategory,
  MaintenancePriority,
} from '../../gen/hotel/housekeeping/v1/maintenance_pb';
import { RoomStatus } from '../../gen/hotel/rooms/v1/room_pb';
import type {
  HousekeepingTask as PbTask,
  HousekeepingBoardRoom,
} from '../../gen/hotel/housekeeping/v1/housekeeping_pb';
import type { MaintenanceTicket as PbTicket } from '../../gen/hotel/housekeeping/v1/maintenance_pb';
import type {
  AssignableStaffMember,
  AssignableStaffScope as RestStaffScope,
  CreateHousekeepingTaskRequest,
  HousekeepingBoardResponse,
  HousekeepingTask,
  HousekeepingTaskListResponse,
  ListHousekeepingTasksQuery,
  UpdateHousekeepingTaskRequest,
} from '../../types/housekeeping.types';
import type {
  CreateMaintenanceTicketRequest,
  ListMaintenanceTicketsQuery,
  MaintenanceTicket,
  MaintenanceTicketListResponse,
  UpdateMaintenanceTicketRequest,
} from '../../types/maintenance.types';

export function taskFromPb(t: PbTask): HousekeepingTask {
  return {
    id: nameId(t.name),
    room_id: nameId(t.room),
    room_number: t.roomNumber,
    room_type: t.roomType,
    task_type: enumToRest(HousekeepingTaskType, t.taskType) ?? '',
    priority: enumToRest(HousekeepingPriority, t.priority) as HousekeepingTask['priority'],
    status: enumToRest(HousekeepingTaskStatus, t.status) as HousekeepingTask['status'],
    ...(t.assignedTo ? { assigned_to: nameId(t.assignedTo) } : {}),
    ...(t.assignedToName ? { assigned_to_name: t.assignedToName } : {}),
    ...(gdateToString(t.scheduledDate) ? { scheduled_date: gdateToString(t.scheduledDate) } : {}),
    task_date: gdateToString(t.taskDate) ?? '',
    ...(tsToIso(t.startedAt) ? { started_at: tsToIso(t.startedAt) } : {}),
    ...(tsToIso(t.completedAt) ? { completed_at: tsToIso(t.completedAt) } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
    ...(t.inspectionNotes ? { inspection_notes: t.inspectionNotes } : {}),
    ...(t.itemsUsed !== undefined ? { items_used: valueToJson(t.itemsUsed) } : {}),
    created_at: tsToIso(t.createdAt) ?? '',
    ...(t.createdBy ? { created_by: nameId(t.createdBy) } : {}),
    updated_at: tsToIso(t.updatedAt) ?? '',
  };
}

export function ticketFromPb(t: PbTicket): MaintenanceTicket {
  return {
    id: nameId(t.name),
    ...(t.room ? { room_id: nameId(t.room) } : {}),
    ...(t.roomNumber ? { room_number: t.roomNumber } : {}),
    ticket_number: t.ticketNumber,
    title: t.title,
    ...(t.description ? { description: t.description } : {}),
    category: enumToRest(MaintenanceCategory, t.category) as MaintenanceTicket['category'],
    priority: enumToRest(MaintenancePriority, t.priority) as MaintenanceTicket['priority'],
    status: enumToRest(MaintenanceStatus, t.status) as MaintenanceTicket['status'],
    ...(t.assignedTo ? { assigned_to: nameId(t.assignedTo) } : {}),
    ...(t.assignedToName ? { assigned_to_name: t.assignedToName } : {}),
    ...(t.reportedBy ? { reported_by: nameId(t.reportedBy) } : {}),
    ...(t.estimatedCost ? { estimated_cost: moneyToMajor(t.estimatedCost) } : {}),
    ...(t.actualCost ? { actual_cost: moneyToMajor(t.actualCost) } : {}),
    ...(t.estimatedHours ? { estimated_hours: decimalToNumber(t.estimatedHours) } : {}),
    ...(t.actualHours ? { actual_hours: decimalToNumber(t.actualHours) } : {}),
    ...(tsToIso(t.scheduledDate) ? { scheduled_date: tsToIso(t.scheduledDate) } : {}),
    ...(tsToIso(t.startedAt) ? { started_at: tsToIso(t.startedAt) } : {}),
    ...(tsToIso(t.resolvedAt) ? { resolved_at: tsToIso(t.resolvedAt) } : {}),
    resolution_notes: t.resolutionNotes,
    ...(t.images !== undefined ? { images: valueToJson(t.images) } : {}),
    created_at: tsToIso(t.createdAt) ?? '',
    updated_at: tsToIso(t.updatedAt) ?? '',
  };
}

// ---------------------------------------------------------------------------
// HousekeepingService RPCs
// ---------------------------------------------------------------------------

export async function getBoard(): Promise<HousekeepingBoardResponse> {
  const res = await housekeepingClient().getHousekeepingBoard({});
  return {
    rooms: res.rooms.map((r: HousekeepingBoardRoom) => ({
      id: nameId(r.room),
      room_number: r.roomNumber,
      room_type: r.roomType,
      ...(r.floor !== undefined ? { floor: r.floor } : {}),
      status: enumToRest(RoomStatus, r.status) ?? '',
      ...(r.openTask ? { open_task: taskFromPb(r.openTask) } : {}),
    })),
  };
}

export async function listTasks(
  params: ListHousekeepingTasksQuery = {},
): Promise<HousekeepingTaskListResponse> {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 0;
  const request = {
    status: restToEnum(HousekeepingTaskStatus, params.status),
    taskType: restToEnum(HousekeepingTaskType, params.task_type),
    room: params.room_id ? roomName(params.room_id) : '',
    assignedTo: params.assigned_to ? userName(params.assigned_to) : '',
    ...(params.unassigned !== undefined ? { unassigned: params.unassigned } : {}),
    scheduledDate: stringToGdate(params.scheduled_date),
    pageSize,
  };
  // page_token walks offsets; reaching REST page N means N sequential calls.
  let pageToken = '';
  let res;
  for (let p = 1; p <= page; p++) {
    res = await housekeepingClient().listHousekeepingTasks({ ...request, pageToken });
    pageToken = res.nextPageToken;
  }
  return {
    items: res!.tasks.map(taskFromPb),
    total: Number(res!.totalSize),
    page,
    page_size: pageSize,
  };
}

export async function createTask(input: CreateHousekeepingTaskRequest): Promise<HousekeepingTask> {
  const res = await housekeepingClient().createHousekeepingTask({
    task: {
      name: '',
      room: roomName(input.room_id),
      roomNumber: '',
      roomType: '',
      taskType: restToEnum(HousekeepingTaskType, input.task_type) ?? HousekeepingTaskType.UNSPECIFIED,
      priority: restToEnum(HousekeepingPriority, input.priority) ?? HousekeepingPriority.UNSPECIFIED,
      status: HousekeepingTaskStatus.UNSPECIFIED,
      assignedTo: input.assigned_to ? userName(input.assigned_to) : '',
      assignedToName: '',
      scheduledDate: stringToGdate(input.scheduled_date),
      notes: input.notes ?? '',
      inspectionNotes: input.inspection_notes ?? '',
      itemsUsed: jsonToValue(input.items_used),
      createdBy: '',
    },
  });
  return taskFromPb(res.task!);
}

export async function updateTask(
  taskId: string | number,
  input: UpdateHousekeepingTaskRequest,
): Promise<HousekeepingTask> {
  const FIELD_MAP: Record<string, string> = {
    priority: 'priority',
    status: 'status',
    assigned_to: 'assigned_to',
    scheduled_date: 'scheduled_date',
    notes: 'notes',
    inspection_notes: 'inspection_notes',
    items_used: 'items_used',
  };
  const paths = Object.keys(input).filter(k => k in FIELD_MAP);
  const res = await housekeepingClient().updateHousekeepingTask({
    task: {
      name: taskName(taskId),
      room: '',
      roomNumber: '',
      roomType: '',
      taskType: HousekeepingTaskType.UNSPECIFIED,
      priority: restToEnum(HousekeepingPriority, input.priority) ?? HousekeepingPriority.UNSPECIFIED,
      status: restToEnum(HousekeepingTaskStatus, input.status) ?? HousekeepingTaskStatus.UNSPECIFIED,
      assignedTo: input.assigned_to ? userName(input.assigned_to) : '',
      assignedToName: '',
      scheduledDate: stringToGdate(input.scheduled_date),
      notes: input.notes ?? '',
      inspectionNotes: input.inspection_notes ?? '',
      itemsUsed: jsonToValue(input.items_used),
      createdBy: '',
    },
    updateMask: { paths },
    clearAssignee: input.clear_assignee ?? false,
  });
  return taskFromPb(res.task!);
}

export async function getAssignableStaff(
  scope: RestStaffScope = 'housekeeping',
): Promise<AssignableStaffMember[]> {
  const res = await housekeepingClient().listAssignableStaff({
    scope: restToEnum(AssignableStaffScope, scope) ?? AssignableStaffScope.UNSPECIFIED,
  });
  return res.staff.map(s => ({
    id: nameId(s.user),
    ...(s.fullName ? { full_name: s.fullName } : {}),
    username: s.username,
  }));
}

// ---------------------------------------------------------------------------
// MaintenanceService RPCs
// ---------------------------------------------------------------------------

export async function listTickets(
  params: ListMaintenanceTicketsQuery = {},
): Promise<MaintenanceTicketListResponse> {
  const page = params.page ?? 1;
  const pageSize = params.page_size ?? 0;
  const request = {
    status: restToEnum(MaintenanceStatus, params.status),
    room: params.room_id ? roomName(params.room_id) : '',
    assignedTo: params.assigned_to ? userName(params.assigned_to) : '',
    category: restToEnum(MaintenanceCategory, params.category),
    priority: restToEnum(MaintenancePriority, params.priority),
    pageSize,
  };
  let pageToken = '';
  let res;
  for (let p = 1; p <= page; p++) {
    res = await maintenanceClient().listMaintenanceTickets({ ...request, pageToken });
    pageToken = res.nextPageToken;
  }
  return {
    items: res!.tickets.map(ticketFromPb),
    total: Number(res!.totalSize),
    page,
    page_size: pageSize,
  };
}

export async function getTicket(id: string | number): Promise<MaintenanceTicket> {
  const res = await maintenanceClient().getMaintenanceTicket({ name: ticketName(id) });
  return ticketFromPb(res.ticket!);
}

export async function createTicket(
  input: CreateMaintenanceTicketRequest,
): Promise<MaintenanceTicket> {
  const res = await maintenanceClient().createMaintenanceTicket({
    ticket: {
      name: '',
      room: input.room_id ? roomName(input.room_id) : '',
      roomNumber: '',
      ticketNumber: '',
      title: input.title,
      description: input.description ?? '',
      category: restToEnum(MaintenanceCategory, input.category) ?? MaintenanceCategory.UNSPECIFIED,
      priority: restToEnum(MaintenancePriority, input.priority) ?? MaintenancePriority.UNSPECIFIED,
      status: MaintenanceStatus.UNSPECIFIED,
      assignedTo: input.assigned_to ? userName(input.assigned_to) : '',
      assignedToName: '',
      reportedBy: '',
      estimatedCost: majorToMoney(input.estimated_cost),
      estimatedHours: numberToDecimal(input.estimated_hours),
      scheduledDate: input.scheduled_date
        ? timestampFromDate(new Date(`${input.scheduled_date}T00:00:00Z`))
        : undefined,
      resolutionNotes: '',
      images: jsonToValue(input.images),
    },
  });
  return ticketFromPb(res.ticket!);
}

export async function updateTicket(
  id: string | number,
  input: UpdateMaintenanceTicketRequest,
): Promise<MaintenanceTicket> {
  const MUTABLE_FIELDS = new Set([
    'title',
    'description',
    'category',
    'priority',
    'status',
    'assigned_to',
    'estimated_cost',
    'actual_cost',
    'estimated_hours',
    'actual_hours',
    'scheduled_date',
    'resolution_notes',
    'images',
  ]);
  const paths = Object.keys(input).filter(k => MUTABLE_FIELDS.has(k));
  const res = await maintenanceClient().updateMaintenanceTicket({
    ticket: {
      name: ticketName(id),
      room: '',
      roomNumber: '',
      ticketNumber: '',
      title: input.title ?? '',
      description: input.description ?? '',
      category: restToEnum(MaintenanceCategory, input.category) ?? MaintenanceCategory.UNSPECIFIED,
      priority: restToEnum(MaintenancePriority, input.priority) ?? MaintenancePriority.UNSPECIFIED,
      status: restToEnum(MaintenanceStatus, input.status) ?? MaintenanceStatus.UNSPECIFIED,
      assignedTo: input.assigned_to ? userName(input.assigned_to) : '',
      assignedToName: '',
      reportedBy: '',
      estimatedCost: majorToMoney(input.estimated_cost),
      actualCost: majorToMoney(input.actual_cost),
      estimatedHours: numberToDecimal(input.estimated_hours),
      actualHours: numberToDecimal(input.actual_hours),
      scheduledDate: input.scheduled_date
        ? timestampFromDate(new Date(`${input.scheduled_date}T00:00:00Z`))
        : undefined,
      resolutionNotes: input.resolution_notes ?? '',
      images: jsonToValue(input.images),
    },
    updateMask: { paths },
    clearAssignee: input.clear_assignee ?? false,
  });
  return ticketFromPb(res.ticket!);
}
