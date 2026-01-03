// Audit log type definitions

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  resource_type: string;
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

export interface AuditLogQuery {
  user_id?: number;
  action?: string;
  resource_type?: string;
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

// Action type display configuration
export const AUDIT_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  login_success: { label: 'Login Success', color: '#4caf50' },
  login_failure: { label: 'Login Failed', color: '#f44336' },
  logout: { label: 'Logout', color: '#9e9e9e' },
  booking_created: { label: 'Booking Created', color: '#2196f3' },
  booking_updated: { label: 'Booking Updated', color: '#ff9800' },
  booking_cancelled: { label: 'Booking Cancelled', color: '#f44336' },
  booking_checkin: { label: 'Guest Checked In', color: '#4caf50' },
  booking_checkout: { label: 'Guest Checked Out', color: '#9c27b0' },
  guest_created: { label: 'Guest Created', color: '#2196f3' },
  guest_updated: { label: 'Guest Updated', color: '#ff9800' },
  guest_deleted: { label: 'Guest Deleted', color: '#f44336' },
  user_created: { label: 'User Created', color: '#2196f3' },
  role_assigned: { label: 'Role Assigned', color: '#4caf50' },
  role_removed: { label: 'Role Removed', color: '#f44336' },
  settings_changed: { label: 'Settings Changed', color: '#ff9800' },
  password_changed: { label: 'Password Changed', color: '#9c27b0' },
  ekyc_approved: { label: 'eKYC Approved', color: '#4caf50' },
  ekyc_rejected: { label: 'eKYC Rejected', color: '#f44336' },
};

// Resource type display configuration
export const AUDIT_RESOURCE_LABELS: Record<string, { label: string; color: string }> = {
  user: { label: 'User', color: '#3f51b5' },
  guest: { label: 'Guest', color: '#009688' },
  booking: { label: 'Booking', color: '#673ab7' },
  room: { label: 'Room', color: '#795548' },
  user_role: { label: 'User Role', color: '#607d8b' },
  system_setting: { label: 'Settings', color: '#ff5722' },
  ekyc_verification: { label: 'eKYC', color: '#00bcd4' },
};

// Helper function to get action label
export function getActionLabel(action: string): { label: string; color: string } {
  return AUDIT_ACTION_LABELS[action] || { label: action.replace(/_/g, ' '), color: '#757575' };
}

// Helper function to get resource label
export function getResourceLabel(resourceType: string): { label: string; color: string } {
  return AUDIT_RESOURCE_LABELS[resourceType] || { label: resourceType.replace(/_/g, ' '), color: '#757575' };
}
