import { HTTPError } from 'ky';
import { api, APIError } from './client';
import {
  Role,
  Permission,
  RoleInput,
  PermissionInput,
  AssignRoleInput,
  AssignPermissionInput,
  RolePermissionIdsInput,
  UserRoleIdsInput,
  RoleWithPermissions,
  RbacSnapshot,
  RouteAccessPolicy,
  RouteAccessPolicyInput,
  User,
  UserWithRolesAndPermissions,
} from '../types';
import { withRetry } from '../utils/retry';

export interface SystemSetting {
  id: number;
  key: string;
  value: string;
  description?: string | null;
  category?: string | null;
  created_at: string;
  updated_at: string;
}

/** Key/value pair from the unauthenticated `settings/public` endpoint. */
export type PublicSetting = Pick<SystemSetting, 'key' | 'value'>;

const PUBLIC_SETTINGS_TIMEOUT_MS = 3_000;

export class AdminService {
  // RBAC Operations
  static async getRbacSnapshot(): Promise<RbacSnapshot> {
    return await withRetry(
      () => api.get('rbac/snapshot').json<RbacSnapshot>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async getRouteAccessPolicies(): Promise<RouteAccessPolicy[]> {
    return await withRetry(
      () => api.get('rbac/route-policies').json<RouteAccessPolicy[]>(),
      { maxAttempts: 3, initialDelay: 1000 }
    );
  }

  static async updateRouteAccessPolicy(
    routeId: string,
    input: RouteAccessPolicyInput
  ): Promise<RouteAccessPolicy> {
    return await withRetry(
      () => api.put(`rbac/route-policies/${routeId}`, { json: input }).json<RouteAccessPolicy>(),
      { maxAttempts: 2, initialDelay: 1000 }
    );
  }

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

  static async assignPermissionToRole(assignData: AssignPermissionInput): Promise<void> {
    await api.post('rbac/roles/permissions', { json: assignData });
  }

  static async removePermissionFromRole(roleId: string, permissionId: string): Promise<void> {
    await api.delete(`rbac/roles/${roleId}/permissions/${permissionId}`);
  }

  static async replaceRolePermissions(roleId: string, input: RolePermissionIdsInput): Promise<void> {
    await api.put(`rbac/roles/${roleId}/permissions`, { json: input });
  }

  static async getRolePermissions(roleId: string): Promise<RoleWithPermissions> {
    return await api.get(`rbac/roles/${roleId}/permissions`).json<RoleWithPermissions>();
  }

  // System Settings
  static async getSystemSettings(): Promise<SystemSetting[]> {
    return await api.get('settings').json<SystemSetting[]>();
  }

  /**
   * Settings the backend marks `is_public` (hotel identity, check-in/out times,
   * currency, code lists). No authentication required, so the login screen can
   * read them. Called during boot — a short timeout keeps an unreachable or
   * slow backend from delaying the first paint.
   */
  static async getPublicSettings(): Promise<PublicSetting[]> {
    return await api
      .get('settings/public', { timeout: PUBLIC_SETTINGS_TIMEOUT_MS, retry: 0 })
      .json<PublicSetting[]>();
  }

  static async updateSystemSetting(key: string, value: string): Promise<SystemSetting> {
    return await api.patch(`settings/${key}`, { json: { value } }).json<SystemSetting>();
  }
}
