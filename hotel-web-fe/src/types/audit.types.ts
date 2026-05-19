// Audit log type definitions
import { AUDIT_ACTION_LABELS, AUDIT_RESOURCE_LABELS } from '../constants/audit.constants';

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  resource_type: string;
  /** Activity stream derived from resource_type: rooms|guests|bookings|system|reports|other */
  category: string;
  resource_id: number | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface AuditCategoryCounts {
  rooms: number;
  guests: number;
  bookings: number;
  system: number;
  reports: number;
  other: number;
  total: number;
}

export type AuditCategoryId = 'rooms' | 'guests' | 'bookings' | 'system' | 'reports';

export interface AuditLogQuery {
  user_id?: number;
  action?: string;
  resource_type?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
  search?: string;
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface AuditUser {
  id: number;
  username: string;
}

// Helper function to get action label
export function getActionLabel(action: string): { label: string; color: string } {
  return AUDIT_ACTION_LABELS[action] || { label: action.replace(/_/g, ' '), color: '#757575' };
}

// Helper function to get resource label
export function getResourceLabel(resourceType: string): { label: string; color: string } {
  return AUDIT_RESOURCE_LABELS[resourceType] || { label: resourceType.replace(/_/g, ' '), color: '#757575' };
}
