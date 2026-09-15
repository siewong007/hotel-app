// Action/resource label + status tone. Colors are --hotel-* token references so
// chips follow the active theme instead of carrying a private palette.
export const AUDIT_ACTION_LABELS: Record<string, { labelKey: string; color: string }> = {
  login_success: { labelKey: 'admin:audit.action.login_success', color: 'var(--hotel-success)' },
  login_failure: { labelKey: 'admin:audit.action.login_failure', color: 'var(--hotel-danger)' },
  logout: { labelKey: 'admin:audit.action.logout', color: 'var(--hotel-neutral)' },
  booking_created: { labelKey: 'admin:audit.action.booking_created', color: 'var(--hotel-info)' },
  booking_updated: { labelKey: 'admin:audit.action.booking_updated', color: 'var(--hotel-warning)' },
  booking_cancelled: { labelKey: 'admin:audit.action.booking_cancelled', color: 'var(--hotel-danger)' },
  booking_voided: { labelKey: 'admin:audit.action.booking_voided', color: 'var(--hotel-danger)' },
  booking_checkin: { labelKey: 'admin:audit.action.booking_checkin', color: 'var(--hotel-success)' },
  booking_checkout: { labelKey: 'admin:audit.action.booking_checkout', color: 'var(--hotel-chart-4)' },
  room_status_changed: { labelKey: 'admin:audit.action.room_status_changed', color: 'var(--hotel-warning)' },
  guest_created: { labelKey: 'admin:audit.action.guest_created', color: 'var(--hotel-info)' },
  guest_updated: { labelKey: 'admin:audit.action.guest_updated', color: 'var(--hotel-warning)' },
  guest_deleted: { labelKey: 'admin:audit.action.guest_deleted', color: 'var(--hotel-danger)' },
  user_created: { labelKey: 'admin:audit.action.user_created', color: 'var(--hotel-info)' },
  role_assigned: { labelKey: 'admin:audit.action.role_assigned', color: 'var(--hotel-success)' },
  role_removed: { labelKey: 'admin:audit.action.role_removed', color: 'var(--hotel-danger)' },
  settings_changed: { labelKey: 'admin:audit.action.settings_changed', color: 'var(--hotel-warning)' },
  password_changed: { labelKey: 'admin:audit.action.password_changed', color: 'var(--hotel-chart-4)' },
  ekyc_approved: { labelKey: 'admin:audit.action.ekyc_approved', color: 'var(--hotel-success)' },
  ekyc_rejected: { labelKey: 'admin:audit.action.ekyc_rejected', color: 'var(--hotel-danger)' },
};

export const AUDIT_RESOURCE_LABELS: Record<string, { labelKey: string; color: string }> = {
  user: { labelKey: 'admin:audit.resource.user', color: 'var(--hotel-info)' },
  guest: { labelKey: 'admin:audit.resource.guest', color: 'var(--hotel-success)' },
  booking: { labelKey: 'admin:audit.resource.booking', color: 'var(--hotel-chart-4)' },
  room: { labelKey: 'admin:audit.resource.room', color: 'var(--hotel-warning)' },
  user_role: { labelKey: 'admin:audit.resource.user_role', color: 'var(--hotel-neutral)' },
  system_setting: { labelKey: 'admin:audit.resource.system_setting', color: 'var(--hotel-warning)' },
  ekyc_verification: { labelKey: 'admin:audit.resource.ekyc_verification', color: 'var(--hotel-info)' },
};
