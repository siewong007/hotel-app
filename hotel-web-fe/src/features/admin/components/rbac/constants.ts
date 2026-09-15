// Permission category configuration with display metadata
export const PERMISSION_CATEGORIES: Record<string, { labelKey: string; icon: string; color: string }> = {
  rooms: { labelKey: 'admin:rbac.permCat.rooms', icon: 'Hotel', color: 'var(--hotel-info)' },
  bookings: { labelKey: 'admin:rbac.permCat.bookings', icon: 'EventNote', color: 'var(--hotel-success)' },
  guests: { labelKey: 'admin:rbac.permCat.guests', icon: 'People', color: 'var(--hotel-warning)' },
  users: { labelKey: 'admin:rbac.permCat.users', icon: 'PersonAdd', color: 'var(--hotel-chart-4)' },
  roles: { labelKey: 'admin:rbac.permCat.roles', icon: 'Security', color: 'var(--hotel-danger)' },
  permissions: { labelKey: 'admin:rbac.permCat.permissions', icon: 'VpnKey', color: 'var(--hotel-chart-4)' },
  navigation: { labelKey: 'admin:rbac.permCat.navigation', icon: 'Navigation', color: 'var(--hotel-chart-4)' },
  settings: { labelKey: 'admin:rbac.permCat.settings', icon: 'Settings', color: 'var(--hotel-neutral)' },
  ekyc: { labelKey: 'admin:rbac.permCat.ekyc', icon: 'VerifiedUser', color: 'var(--hotel-info)' },
  rbac: { labelKey: 'admin:rbac.permCat.rbac', icon: 'Security', color: 'var(--hotel-danger)' },
  loyalty: { labelKey: 'admin:rbac.permCat.loyalty', icon: 'CardGiftcard', color: 'var(--hotel-primary)' },
  rewards: { labelKey: 'admin:rbac.permCat.rewards', icon: 'Star', color: 'var(--hotel-warning)' },
  ledgers: { labelKey: 'admin:rbac.permCat.ledgers', icon: 'AccountBalance', color: 'var(--hotel-neutral)' },
  analytics: { labelKey: 'admin:rbac.permCat.analytics', icon: 'Assessment', color: 'var(--hotel-info)' },
};

// Role colors for visual distinction
export const ROLE_COLORS: Record<string, string> = {
  super_admin: 'var(--hotel-chart-4)',
  admin: 'var(--hotel-danger)',
  manager: 'var(--hotel-info)',
  receptionist: 'var(--hotel-success)',
  guest: 'var(--hotel-neutral)',
  default: 'var(--hotel-neutral)',
};

// Get category color with fallback
export const getCategoryColor = (category: string): string => {
  return PERMISSION_CATEGORIES[category]?.color || 'var(--hotel-neutral)';
};

// Get role color with fallback
export const getRoleColor = (roleName: string): string => {
  return ROLE_COLORS[roleName.toLowerCase()] || ROLE_COLORS.default;
};
