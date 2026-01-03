import type { Permission, Role } from '../../../../types';

// Permission category for grouping
export interface PermissionCategory {
  name: string;
  displayName: string;
  icon: string;
  color: string;
  permissions: Permission[];
}

// Navigation item configuration
export interface NavigationItem {
  id: string;
  label: string;
  path: string;
  icon: string;
  description: string;
  category: 'core' | 'management' | 'analytics' | 'system';
}

// Navigation category for grouping
export interface NavigationCategory {
  id: 'core' | 'management' | 'analytics' | 'system';
  label: string;
  items: NavigationItem[];
}

// Permission mapping for navigation items
export interface NavigationPermissionDef {
  name: string;
  resource: string;
  action: string;
  description: string;
}

// Role with computed stats
export interface RoleWithStats extends Role {
  permissionCount: number;
  navigationCount: number;
  permissions: Permission[];
  navigationItems: string[];
}

// Form data for role editing
export interface RoleFormData {
  name: string;
  description: string;
  navigationItems: string[];
  permissionIds: number[];
}

// Role-permission mapping for quick lookups
export type RolePermissionMap = Record<number, Set<number>>;

// Props for role chips
export interface RoleChipProps {
  role: Role;
  onRemove?: () => void;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
}
