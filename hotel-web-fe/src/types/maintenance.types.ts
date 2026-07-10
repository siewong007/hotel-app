export type MaintenancePriority = 'low' | 'medium' | 'high' | 'critical';
export type MaintenanceStatus = 'open' | 'in_progress' | 'on_hold' | 'resolved' | 'closed';
export type MaintenanceCategory =
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'furniture'
  | 'appliance'
  | 'structural'
  | 'other';

export interface MaintenanceTicket {
  id: number;
  room_id?: number;
  room_number?: string;
  ticket_number: string;
  title: string;
  description?: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assigned_to?: number;
  assigned_to_name?: string;
  reported_by?: number;
  estimated_cost?: number | string;
  actual_cost?: number | string;
  estimated_hours?: number | string;
  actual_hours?: number | string;
  scheduled_date?: string;
  started_at?: string;
  resolved_at?: string;
  resolution_notes?: string;
  images?: unknown;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceTicketListResponse {
  items: MaintenanceTicket[];
  total: number;
  page: number;
  page_size: number;
}

export interface CreateMaintenanceTicketRequest {
  room_id?: number;
  title: string;
  description?: string;
  category?: MaintenanceCategory;
  priority?: MaintenancePriority;
  assigned_to?: number;
  estimated_cost?: number | string;
  estimated_hours?: number | string;
  scheduled_date?: string;
  images?: unknown;
}

export interface UpdateMaintenanceTicketRequest {
  title?: string;
  description?: string;
  category?: MaintenanceCategory;
  priority?: MaintenancePriority;
  status?: MaintenanceStatus;
  assigned_to?: number;
  estimated_cost?: number | string;
  actual_cost?: number | string;
  estimated_hours?: number | string;
  actual_hours?: number | string;
  scheduled_date?: string;
  resolution_notes?: string;
  images?: unknown;
}

export interface ListMaintenanceTicketsQuery {
  status?: MaintenanceStatus;
  room_id?: number;
  assigned_to?: number;
  category?: MaintenanceCategory;
  priority?: MaintenancePriority;
  page?: number;
  page_size?: number;
}
