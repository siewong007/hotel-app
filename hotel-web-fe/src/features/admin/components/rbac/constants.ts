// Permission category configuration with display metadata
export const PERMISSION_CATEGORIES: Record<string, { displayName: string; icon: string; color: string }> = {
  rooms: { displayName: 'Rooms', icon: 'Hotel', color: '#1976d2' },
  bookings: { displayName: 'Bookings', icon: 'EventNote', color: '#2e7d32' },
  guests: { displayName: 'Guests', icon: 'People', color: '#ed6c02' },
  users: { displayName: 'Users', icon: 'PersonAdd', color: '#7b1fa2' },
  roles: { displayName: 'Roles', icon: 'Security', color: '#d32f2f' },
  permissions: { displayName: 'Permissions', icon: 'VpnKey', color: '#c2185b' },
  navigation: { displayName: 'Navigation', icon: 'Navigation', color: '#9c27b0' },
  settings: { displayName: 'Settings', icon: 'Settings', color: '#757575' },
  ekyc: { displayName: 'eKYC', icon: 'VerifiedUser', color: '#0288d1' },
  rbac: { displayName: 'Access Control', icon: 'Security', color: '#d32f2f' },
  loyalty: { displayName: 'Loyalty', icon: 'CardGiftcard', color: '#f57c00' },
  rewards: { displayName: 'Rewards', icon: 'Star', color: '#fbc02d' },
  ledgers: { displayName: 'Ledgers', icon: 'AccountBalance', color: '#5d4037' },
  analytics: { displayName: 'Analytics', icon: 'Assessment', color: '#00838f' },
};

// Role colors for visual distinction
export const ROLE_COLORS: Record<string, string> = {
  super_admin: '#6a1b9a',
  admin: '#d32f2f',
  manager: '#1976d2',
  receptionist: '#2e7d32',
  guest: '#757575',
  default: '#9e9e9e',
};

// Get category color with fallback
export const getCategoryColor = (category: string): string => {
  return PERMISSION_CATEGORIES[category]?.color || '#9e9e9e';
};

// Get role color with fallback
export const getRoleColor = (roleName: string): string => {
  return ROLE_COLORS[roleName.toLowerCase()] || ROLE_COLORS.default;
};
