import type { Permission, Role } from '../../../../types';

// Permission category for grouping
export interface PermissionCategory {
  name: string;
  displayName: string;
  icon: string;
  color: string;
  permissions: Permission[];
}

// Role with computed stats
export interface RoleWithStats extends Role {
  permissionCount: number;
  navigationCount: number;
  permissions: Permission[];
  navigationItems: string[];
}

// Role-permission mapping for quick lookups
export type RolePermissionMap = Record<number, Set<number>>;
