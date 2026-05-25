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

export interface RolePermissionIdsInput {
  permission_ids: number[];
}

export interface UserRoleIdsInput {
  role_ids: number[];
}

export interface RolePermissionAssignment {
  role_id: number;
  permission_id: number;
}

export interface UserRoleAssignment {
  user_id: number | string;
  role_id: number;
}

export interface RbacSnapshot {
  roles: Role[];
  permissions: Permission[];
  users: User[];
  role_permissions: RolePermissionAssignment[];
  user_roles: UserRoleAssignment[];
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
