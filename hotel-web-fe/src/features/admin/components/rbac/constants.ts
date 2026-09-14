// Permission category configuration with display metadata
export const PERMISSION_CATEGORIES: Record<string, { displayName: string; icon: string; color: string }> = {
  rooms: { displayName: 'Rooms', icon: 'Hotel', color: 'var(--hotel-info)' },
  bookings: { displayName: 'Bookings', icon: 'EventNote', color: 'var(--hotel-success)' },
  guests: { displayName: 'Guests', icon: 'People', color: 'var(--hotel-warning)' },
  users: { displayName: 'Users', icon: 'PersonAdd', color: 'var(--hotel-chart-4)' },
  roles: { displayName: 'Roles', icon: 'Security', color: 'var(--hotel-danger)' },
  permissions: { displayName: 'Permissions', icon: 'VpnKey', color: 'var(--hotel-chart-4)' },
  navigation: { displayName: 'Navigation', icon: 'Navigation', color: 'var(--hotel-chart-4)' },
  settings: { displayName: 'Settings', icon: 'Settings', color: 'var(--hotel-neutral)' },
  ekyc: { displayName: 'eKYC', icon: 'VerifiedUser', color: 'var(--hotel-info)' },
  rbac: { displayName: 'Access Control', icon: 'Security', color: 'var(--hotel-danger)' },
  loyalty: { displayName: 'Loyalty', icon: 'CardGiftcard', color: 'var(--hotel-primary)' },
  rewards: { displayName: 'Rewards', icon: 'Star', color: 'var(--hotel-warning)' },
  ledgers: { displayName: 'Ledgers', icon: 'AccountBalance', color: 'var(--hotel-neutral)' },
  analytics: { displayName: 'Analytics', icon: 'Assessment', color: 'var(--hotel-info)' },
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
