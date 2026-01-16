// RBAC (Role-Based Access Control) type definitions
import type { User } from './auth.types';

export interface Role {
  id: number;
  name: string;
  description?: string;
  created_at: string;
}

export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string;
  created_at: string;
}

export interface RoleInput {
  name: string;
  description?: string;
}

export interface PermissionInput {
  name: string;
  resource: string;
  action: string;
  description?: string;
}

export interface AssignRoleInput {
  user_id: string;
  role_id: number;
}

export interface AssignPermissionInput {
  role_id: number;
  permission_id: number;
}

export interface RoleWithPermissions {
  role: Role;
  permissions: Permission[];
}

export interface UserWithRolesAndPermissions {
  user: User;
  roles: Role[];
  permissions: Permission[];
}
