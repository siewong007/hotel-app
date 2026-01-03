import { HTTPError } from 'ky';
import { api, APIError } from './client';
import {
  Role,
  Permission,
  RoleInput,
  PermissionInput,
  AssignRoleInput,
  AssignPermissionInput,
  RoleWithPermissions,
  User,
  UserWithRolesAndPermissions,
} from '../types';
import { withRetry } from '../utils/retry';

export class AdminService {
  // RBAC Operations
  static async getAllRoles(): Promise<Role[]> {
    return await withRetry(
      () => api.get('rbac/roles').json<Role[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async createRole(roleData: RoleInput): Promise<Role> {
    return await withRetry(
      () => api.post('rbac/roles', { json: roleData }).json<Role>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async updateRole(roleId: string, roleData: RoleInput): Promise<Role> {
    return await withRetry(
      () => api.put(`rbac/roles/${roleId}`, { json: roleData }).json<Role>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async deleteRole(roleId: string): Promise<void> {
    await api.delete(`rbac/roles/${roleId}`);
  }

  static async getAllPermissions(): Promise<Permission[]> {
    return await withRetry(
      () => api.get('rbac/permissions').json<Permission[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async createPermission(permissionData: PermissionInput): Promise<Permission> {
    return await withRetry(
      () => api.post('rbac/permissions', { json: permissionData }).json<Permission>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async updatePermission(permissionId: string, permissionData: PermissionInput): Promise<Permission> {
    return await withRetry(
      () => api.put(`rbac/permissions/${permissionId}`, { json: permissionData }).json<Permission>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async deletePermission(permissionId: string): Promise<void> {
    await api.delete(`rbac/permissions/${permissionId}`);
  }

  static async assignRoleToUser(assignData: AssignRoleInput): Promise<void> {
    await api.post('rbac/users/roles', { json: assignData });
  }

  static async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await api.delete(`rbac/users/${userId}/roles/${roleId}`);
  }

  static async assignPermissionToRole(assignData: AssignPermissionInput): Promise<void> {
    await api.post('rbac/roles/permissions', { json: assignData });
  }

  static async removePermissionFromRole(roleId: string, permissionId: string): Promise<void> {
    await api.delete(`rbac/roles/${roleId}/permissions/${permissionId}`);
  }

  static async getRolePermissions(roleId: string): Promise<RoleWithPermissions> {
    return await api.get(`rbac/roles/${roleId}/permissions`).json<RoleWithPermissions>();
  }

  static async getAllUsers(): Promise<User[]> {
    return await withRetry(
      () => api.get('rbac/users').json<User[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async createUser(userData: {
    username: string;
    email: string;
    password: string;
    full_name?: string;
    phone?: string;
    role_ids?: number[]
  }): Promise<User> {
    return await withRetry(
      () => api.post('rbac/users', { json: userData }).json<User>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async getUserRolesAndPermissions(userId: string): Promise<UserWithRolesAndPermissions> {
    return await withRetry(
      () => api.get(`rbac/users/${userId}`).json<UserWithRolesAndPermissions>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async updateUser(userId: string, userData: {
    username?: string;
    email?: string;
    full_name?: string;
    phone?: string;
    is_active?: boolean;
    password?: string;
  }): Promise<User> {
    return await withRetry(
      () => api.patch(`rbac/users/${userId}`, { json: userData }).json<User>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

  static async deleteUser(userId: string): Promise<void> {
    await api.delete(`rbac/users/${userId}`);
  }

  // System Settings
  static async getSystemSettings(): Promise<any[]> {
    return await api.get('settings').json();
  }

  static async updateSystemSetting(key: string, value: string): Promise<any> {
    return await api.patch(`settings/${key}`, { json: { value } }).json();
  }
}
