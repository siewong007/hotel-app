import type { NavigationItem, NavigationPermissionDef } from './types';

// Permission category configuration with display metadata
export const PERMISSION_CATEGORIES: Record<string, { displayName: string; icon: string; color: string }> = {
  rooms: { displayName: 'Rooms', icon: 'Hotel', color: '#1976d2' },
  bookings: { displayName: 'Bookings', icon: 'EventNote', color: '#2e7d32' },
  guests: { displayName: 'Guests', icon: 'People', color: '#ed6c02' },
  users: { displayName: 'Users', icon: 'PersonAdd', color: '#7b1fa2' },
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
  superadmin: '#6a1b9a',
  admin: '#d32f2f',
  manager: '#1976d2',
  receptionist: '#2e7d32',
  guest: '#757575',
  default: '#9e9e9e',
};

// Navigation category labels
export const NAVIGATION_CATEGORY_LABELS: Record<string, string> = {
  core: 'Core',
  management: 'Management',
  analytics: 'Analytics',
  system: 'System',
};

// Navigation items configuration
export const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: 'timeline', label: 'Reservation Timeline', path: '/timeline', icon: 'EventNote', description: 'View and manage room reservations timeline', category: 'core' },
  { id: 'my-bookings', label: 'My Bookings', path: '/my-bookings', icon: 'Book', description: 'View personal bookings (Guest only)', category: 'core' },
  { id: 'guest-config', label: 'Guest', path: '/guest-config', icon: 'People', description: 'Manage guest profiles and information', category: 'management' },
  { id: 'room-config', label: 'Room Configuration', path: '/room-config', icon: 'Hotel', description: 'Manage room types and configurations', category: 'management' },
  { id: 'room-type-config', label: 'Room Types', path: '/room-type-config', icon: 'Category', description: 'Configure room type settings and pricing', category: 'management' },
  { id: 'bookings', label: 'Bookings', path: '/bookings', icon: 'CalendarMonth', description: 'View and manage all bookings', category: 'management' },
  { id: 'room-management', label: 'Room Management', path: '/room-management', icon: 'HomeWork', description: 'Comprehensive room status and management dashboard', category: 'management' },
  { id: 'company-ledger', label: 'Company Ledger', path: '/company-ledger', icon: 'AccountBalance', description: 'Manage company accounts and ledgers', category: 'management' },
  { id: 'complimentary', label: 'Complimentary', path: '/complimentary', icon: 'CardGiftcard', description: 'Manage complimentary nights and credits', category: 'management' },
  { id: 'loyalty', label: 'Loyalty Portal', path: '/loyalty', icon: 'CardGiftcard', description: 'Manage loyalty program and rewards', category: 'analytics' },
  { id: 'my-rewards', label: 'My Rewards', path: '/my-rewards', icon: 'Star', description: 'View personal rewards (Guest only)', category: 'core' },
  { id: 'reports', label: 'Reports', path: '/reports', icon: 'Assessment', description: 'View reports and analytics', category: 'analytics' },
  { id: 'ekyc-admin', label: 'eKYC Verification', path: '/ekyc-admin', icon: 'VerifiedUser', description: 'Manage eKYC verifications', category: 'system' },
  { id: 'rbac', label: 'Roles & Permissions', path: '/rbac', icon: 'Security', description: 'Manage roles and permissions', category: 'system' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'Settings', description: 'System settings and configuration', category: 'system' },
];

// Map navigation items to required page permissions
export const NAVIGATION_PERMISSION_MAPPING: Record<string, NavigationPermissionDef[]> = {
  'timeline': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their availability' },
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
  ],
  'my-bookings': [
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
  ],
  'guest-config': [
    { name: 'guests:read', resource: 'guests', action: 'read', description: 'View guest information' },
    { name: 'guests:manage', resource: 'guests', action: 'manage', description: 'Manage guest profiles and data' },
  ],
  'room-config': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their availability' },
    { name: 'rooms:manage', resource: 'rooms', action: 'manage', description: 'Manage room configurations and settings' },
  ],
  'room-type-config': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their availability' },
    { name: 'rooms:write', resource: 'rooms', action: 'write', description: 'Create and modify room types' },
    { name: 'rooms:manage', resource: 'rooms', action: 'manage', description: 'Full room management access' },
  ],
  'bookings': [
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
    { name: 'bookings:manage', resource: 'bookings', action: 'manage', description: 'Manage all bookings' },
  ],
  'room-management': [
    { name: 'rooms:read', resource: 'rooms', action: 'read', description: 'View rooms and their status' },
    { name: 'rooms:manage', resource: 'rooms', action: 'manage', description: 'Manage room status, availability, and assignments' },
  ],
  'company-ledger': [
    { name: 'ledgers:read', resource: 'ledgers', action: 'read', description: 'View company ledgers' },
    { name: 'ledgers:manage', resource: 'ledgers', action: 'manage', description: 'Manage company accounts' },
  ],
  'complimentary': [
    { name: 'bookings:read', resource: 'bookings', action: 'read', description: 'View booking information' },
    { name: 'bookings:update', resource: 'bookings', action: 'update', description: 'Update booking details' },
  ],
  'loyalty': [
    { name: 'loyalty:read', resource: 'loyalty', action: 'read', description: 'View loyalty program data' },
    { name: 'loyalty:manage', resource: 'loyalty', action: 'manage', description: 'Manage loyalty program' },
  ],
  'my-rewards': [
    { name: 'rewards:read', resource: 'rewards', action: 'read', description: 'View reward information' },
  ],
  'reports': [
    { name: 'analytics:read', resource: 'analytics', action: 'read', description: 'View analytics and reports' },
  ],
  'ekyc-admin': [
    { name: 'ekyc:manage', resource: 'ekyc', action: 'manage', description: 'Manage eKYC verifications' },
  ],
  'rbac': [
    { name: 'rbac:read', resource: 'rbac', action: 'read', description: 'View roles and permissions' },
    { name: 'rbac:manage', resource: 'rbac', action: 'manage', description: 'Manage roles and permissions' },
    { name: 'users:read', resource: 'users', action: 'read', description: 'View user accounts' },
    { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage user accounts and role assignments' },
  ],
  'settings': [
    { name: 'settings:read', resource: 'settings', action: 'read', description: 'View system settings' },
    { name: 'settings:manage', resource: 'settings', action: 'manage', description: 'Manage system settings' },
  ],
};

// Get category color with fallback
export const getCategoryColor = (category: string): string => {
  return PERMISSION_CATEGORIES[category]?.color || '#9e9e9e';
};

// Get role color with fallback
export const getRoleColor = (roleName: string): string => {
  return ROLE_COLORS[roleName.toLowerCase()] || ROLE_COLORS.default;
};
