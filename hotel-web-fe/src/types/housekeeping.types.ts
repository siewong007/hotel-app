export type HousekeepingTaskStatus = 'pending' | 'in_progress' | 'completed' | 'void';
export type HousekeepingPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface HousekeepingTask {
  id: number;
  room_id: number;
  room_number: string;
  room_type: string;
  task_type: string;
  priority: HousekeepingPriority;
  status: HousekeepingTaskStatus;
  assigned_to?: number;
  assigned_to_name?: string;
  scheduled_date?: string;
  task_date: string;
  started_at?: string;
  completed_at?: string;
  notes?: string;
  inspection_notes?: string;
  items_used?: unknown;
  created_at: string;
  created_by?: number;
  updated_at: string;
}

export interface HousekeepingBoardRoom {
  id: number;
  room_number: string;
  room_type: string;
  floor?: number;
  status: string;
  open_task?: HousekeepingTask;
}

export interface HousekeepingBoardResponse {
  rooms: HousekeepingBoardRoom[];
}

export interface HousekeepingTaskListResponse {
  items: HousekeepingTask[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateHousekeepingTaskRequest {
  room_id: number;
  task_type?: string;
  priority?: HousekeepingPriority;
  assigned_to?: number;
  scheduled_date?: string;
  notes?: string;
  inspection_notes?: string;
  items_used?: unknown;
}

export interface UpdateHousekeepingTaskRequest {
  priority?: HousekeepingPriority;
  status?: HousekeepingTaskStatus;
  assigned_to?: number;
  scheduled_date?: string;
  notes?: string;
  inspection_notes?: string;
  items_used?: unknown;
}

export interface ListHousekeepingTasksQuery {
  status?: HousekeepingTaskStatus;
  room_id?: number;
  assigned_to?: number;
  scheduled_date?: string;
  page?: number;
  page_size?: number;
}
