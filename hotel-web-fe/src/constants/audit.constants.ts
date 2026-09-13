// Action/resource label + status tone. Colors are --hotel-* token references so
// chips follow the active theme instead of carrying a private palette.
export const AUDIT_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  login_success: { label: 'Login Success', color: 'var(--hotel-success)' },
  login_failure: { label: 'Login Failed', color: 'var(--hotel-danger)' },
  logout: { label: 'Logout', color: 'var(--hotel-neutral)' },
  booking_created: { label: 'Booking Created', color: 'var(--hotel-info)' },
  booking_updated: { label: 'Booking Updated', color: 'var(--hotel-warning)' },
  booking_cancelled: { label: 'Booking Voided', color: 'var(--hotel-danger)' },
  booking_voided: { label: 'Booking Voided', color: 'var(--hotel-danger)' },
  booking_checkin: { label: 'Guest Checked In', color: 'var(--hotel-success)' },
  booking_checkout: { label: 'Guest Checked Out', color: 'var(--hotel-chart-4)' },
  room_status_changed: { label: 'Room Status Changed', color: 'var(--hotel-warning)' },
  guest_created: { label: 'Guest Created', color: 'var(--hotel-info)' },
  guest_updated: { label: 'Guest Updated', color: 'var(--hotel-warning)' },
  guest_deleted: { label: 'Guest Deleted', color: 'var(--hotel-danger)' },
  user_created: { label: 'User Created', color: 'var(--hotel-info)' },
  role_assigned: { label: 'Role Assigned', color: 'var(--hotel-success)' },
  role_removed: { label: 'Role Removed', color: 'var(--hotel-danger)' },
  settings_changed: { label: 'Settings Changed', color: 'var(--hotel-warning)' },
  password_changed: { label: 'Password Changed', color: 'var(--hotel-chart-4)' },
  ekyc_approved: { label: 'eKYC Approved', color: 'var(--hotel-success)' },
  ekyc_rejected: { label: 'eKYC Rejected', color: 'var(--hotel-danger)' },
};

export const AUDIT_RESOURCE_LABELS: Record<string, { label: string; color: string }> = {
  user: { label: 'User', color: 'var(--hotel-info)' },
  guest: { label: 'Guest', color: 'var(--hotel-success)' },
  booking: { label: 'Booking', color: 'var(--hotel-chart-4)' },
  room: { label: 'Room', color: 'var(--hotel-warning)' },
  user_role: { label: 'User Role', color: 'var(--hotel-neutral)' },
  system_setting: { label: 'Settings', color: 'var(--hotel-warning)' },
  ekyc_verification: { label: 'eKYC', color: 'var(--hotel-info)' },
};
