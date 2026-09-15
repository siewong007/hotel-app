// Action/resource label + status tone. Labels are `status:` namespace keys —
// resolve them with `t()` at render time so they follow the active locale.
// Colors are --hotel-* token references so chips follow the active theme
// instead of carrying a private palette.
export const AUDIT_ACTION_LABELS: Record<string, { labelKey: string; color: string }> = {
  login_success: { labelKey: 'status:audit.login_success', color: 'var(--hotel-success)' },
  login_failure: { labelKey: 'status:audit.login_failure', color: 'var(--hotel-danger)' },
  logout: { labelKey: 'status:audit.logout', color: 'var(--hotel-neutral)' },
  booking_created: { labelKey: 'status:audit.booking_created', color: 'var(--hotel-info)' },
  booking_updated: { labelKey: 'status:audit.booking_updated', color: 'var(--hotel-warning)' },
  booking_cancelled: { labelKey: 'status:audit.booking_cancelled', color: 'var(--hotel-danger)' },
  booking_voided: { labelKey: 'status:audit.booking_voided', color: 'var(--hotel-danger)' },
  booking_checkin: { labelKey: 'status:audit.booking_checkin', color: 'var(--hotel-success)' },
  booking_checkout: { labelKey: 'status:audit.booking_checkout', color: 'var(--hotel-chart-4)' },
  room_status_changed: { labelKey: 'status:audit.room_status_changed', color: 'var(--hotel-warning)' },
  guest_created: { labelKey: 'status:audit.guest_created', color: 'var(--hotel-info)' },
  guest_updated: { labelKey: 'status:audit.guest_updated', color: 'var(--hotel-warning)' },
  guest_deleted: { labelKey: 'status:audit.guest_deleted', color: 'var(--hotel-danger)' },
  user_created: { labelKey: 'status:audit.user_created', color: 'var(--hotel-info)' },
  role_assigned: { labelKey: 'status:audit.role_assigned', color: 'var(--hotel-success)' },
  role_removed: { labelKey: 'status:audit.role_removed', color: 'var(--hotel-danger)' },
  settings_changed: { labelKey: 'status:audit.settings_changed', color: 'var(--hotel-warning)' },
  password_changed: { labelKey: 'status:audit.password_changed', color: 'var(--hotel-chart-4)' },
  ekyc_approved: { labelKey: 'status:audit.ekyc_approved', color: 'var(--hotel-success)' },
  ekyc_rejected: { labelKey: 'status:audit.ekyc_rejected', color: 'var(--hotel-danger)' },
};

export const AUDIT_RESOURCE_LABELS: Record<string, { labelKey: string; color: string }> = {
  user: { labelKey: 'status:audit_resource.user', color: 'var(--hotel-info)' },
  guest: { labelKey: 'status:audit_resource.guest', color: 'var(--hotel-success)' },
  booking: { labelKey: 'status:audit_resource.booking', color: 'var(--hotel-chart-4)' },
  room: { labelKey: 'status:audit_resource.room', color: 'var(--hotel-warning)' },
  user_role: { labelKey: 'status:audit_resource.user_role', color: 'var(--hotel-neutral)' },
  system_setting: { labelKey: 'status:audit_resource.system_setting', color: 'var(--hotel-warning)' },
  ekyc_verification: { labelKey: 'status:audit_resource.ekyc_verification', color: 'var(--hotel-info)' },
};
