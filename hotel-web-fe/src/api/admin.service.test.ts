import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the configured ky instance so no real HTTP happens.
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    api: {
      get: (...args: any[]) => get(...args),
      post: (...args: any[]) => post(...args),
      put: (...args: any[]) => put(...args),
      patch: (...args: any[]) => patch(...args),
      delete: (...args: any[]) => del(...args),
    },
  };
});

import { AdminService } from './admin.service';

function mockJsonResponse(payload: unknown) {
  return { json: () => Promise.resolve(payload) };
}

describe('AdminService', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    patch.mockReset();
    del.mockReset();
  });

  describe('getRbacSnapshot', () => {
    it('calls GET rbac/snapshot', async () => {
      const snapshot = { roles: [], permissions: [], users: [], role_permissions: [], user_roles: [], route_policies: [] };
      get.mockReturnValue(mockJsonResponse(snapshot));

      const result = await AdminService.getRbacSnapshot();

      expect(get).toHaveBeenCalledWith('rbac/snapshot');
      expect(result).toEqual(snapshot);
    });
  });

  describe('getRouteAccessPolicies', () => {
    it('calls GET rbac/route-policies', async () => {
      const policies = [{ route_id: 'bookings', path: '/bookings' }];
      get.mockReturnValue(mockJsonResponse(policies));

      const result = await AdminService.getRouteAccessPolicies();

      expect(get).toHaveBeenCalledWith('rbac/route-policies');
      expect(result).toEqual(policies);
    });
  });

  describe('updateRouteAccessPolicy', () => {
    it('puts the input as json to rbac/route-policies/<routeId>', async () => {
      const input = {
        required_permissions: ['bookings:read'],
        required_roles: [],
        excluded_roles: [],
        nav_permissions: [],
        nav_roles: [],
        nav_excluded_roles: [],
        is_navigation: true,
      };
      const updated = { route_id: 'bookings', path: '/bookings', ...input };
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await AdminService.updateRouteAccessPolicy('bookings', input);

      expect(put).toHaveBeenCalledWith('rbac/route-policies/bookings', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('getAllRoles', () => {
    it('calls GET rbac/roles', async () => {
      const roles = [{ id: 1, name: 'admin', created_at: 'x' }];
      get.mockReturnValue(mockJsonResponse(roles));

      const result = await AdminService.getAllRoles();

      expect(get).toHaveBeenCalledWith('rbac/roles');
      expect(result).toEqual(roles);
    });
  });

  describe('createRole', () => {
    it('posts the role input as json to rbac/roles', async () => {
      const input = { name: 'manager', description: 'Manages the front desk' };
      const created = { id: 2, ...input, created_at: 'x' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await AdminService.createRole(input);

      expect(post).toHaveBeenCalledWith('rbac/roles', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updateRole', () => {
    it('puts the role input as json to rbac/roles/<roleId>', async () => {
      const input = { name: 'manager-renamed' };
      const updated = { id: 2, ...input, created_at: 'x' };
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await AdminService.updateRole('2', input);

      expect(put).toHaveBeenCalledWith('rbac/roles/2', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteRole', () => {
    it('calls DELETE rbac/roles/<roleId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AdminService.deleteRole('2');

      expect(del).toHaveBeenCalledWith('rbac/roles/2');
    });
  });

  describe('getAllPermissions', () => {
    it('calls GET rbac/permissions', async () => {
      const permissions = [{ id: 1, name: 'bookings:read', resource: 'bookings', action: 'read', created_at: 'x' }];
      get.mockReturnValue(mockJsonResponse(permissions));

      const result = await AdminService.getAllPermissions();

      expect(get).toHaveBeenCalledWith('rbac/permissions');
      expect(result).toEqual(permissions);
    });
  });

  describe('createPermission', () => {
    it('posts the permission input as json to rbac/permissions', async () => {
      const input = { name: 'bookings:void', resource: 'bookings', action: 'void' };
      const created = { id: 3, ...input, created_at: 'x' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await AdminService.createPermission(input);

      expect(post).toHaveBeenCalledWith('rbac/permissions', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('updatePermission', () => {
    it('puts the permission input as json to rbac/permissions/<permissionId>', async () => {
      const input = { name: 'bookings:void', resource: 'bookings', action: 'void', description: 'Void a booking' };
      const updated = { id: 3, ...input, created_at: 'x' };
      put.mockReturnValue(mockJsonResponse(updated));

      const result = await AdminService.updatePermission('3', input);

      expect(put).toHaveBeenCalledWith('rbac/permissions/3', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('deletePermission', () => {
    it('calls DELETE rbac/permissions/<permissionId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AdminService.deletePermission('3');

      expect(del).toHaveBeenCalledWith('rbac/permissions/3');
    });
  });

  describe('assignRoleToUser', () => {
    it('posts the assignment as json to rbac/users/roles', async () => {
      post.mockReturnValue(Promise.resolve(undefined));

      await AdminService.assignRoleToUser({ user_id: '1', role_id: 2 });

      expect(post).toHaveBeenCalledWith('rbac/users/roles', { json: { user_id: '1', role_id: 2 } });
    });
  });

  describe('removeRoleFromUser', () => {
    it('calls DELETE rbac/users/<userId>/roles/<roleId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AdminService.removeRoleFromUser('1', '2');

      expect(del).toHaveBeenCalledWith('rbac/users/1/roles/2');
    });
  });

  describe('replaceUserRoles', () => {
    it('puts the role id list as json to rbac/users/<userId>/roles', async () => {
      put.mockReturnValue(Promise.resolve(undefined));

      await AdminService.replaceUserRoles('1', { role_ids: [2, 3] });

      expect(put).toHaveBeenCalledWith('rbac/users/1/roles', { json: { role_ids: [2, 3] } });
    });
  });

  describe('assignPermissionToRole', () => {
    it('posts the assignment as json to rbac/roles/permissions', async () => {
      post.mockReturnValue(Promise.resolve(undefined));

      await AdminService.assignPermissionToRole({ role_id: 2, permission_id: 3 });

      expect(post).toHaveBeenCalledWith('rbac/roles/permissions', { json: { role_id: 2, permission_id: 3 } });
    });
  });

  describe('removePermissionFromRole', () => {
    it('calls DELETE rbac/roles/<roleId>/permissions/<permissionId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AdminService.removePermissionFromRole('2', '3');

      expect(del).toHaveBeenCalledWith('rbac/roles/2/permissions/3');
    });
  });

  describe('replaceRolePermissions', () => {
    it('puts the permission id list as json to rbac/roles/<roleId>/permissions', async () => {
      put.mockReturnValue(Promise.resolve(undefined));

      await AdminService.replaceRolePermissions('2', { permission_ids: [3, 4] });

      expect(put).toHaveBeenCalledWith('rbac/roles/2/permissions', { json: { permission_ids: [3, 4] } });
    });
  });

  describe('getRolePermissions', () => {
    it('calls GET rbac/roles/<roleId>/permissions', async () => {
      const response = { role: { id: 2, name: 'manager', created_at: 'x' }, permissions: [] };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await AdminService.getRolePermissions('2');

      expect(get).toHaveBeenCalledWith('rbac/roles/2/permissions');
      expect(result).toEqual(response);
    });
  });

  describe('getAllUsers', () => {
    it('calls GET rbac/users', async () => {
      const users = [{ id: '1', username: 'admin', email: 'a@b.com', is_active: true, created_at: 'x', updated_at: 'x' }];
      get.mockReturnValue(mockJsonResponse(users));

      const result = await AdminService.getAllUsers();

      expect(get).toHaveBeenCalledWith('rbac/users');
      expect(result).toEqual(users);
    });
  });

  describe('createUser', () => {
    it('posts the user input as json to rbac/users', async () => {
      const input = { username: 'newstaff', email: 'staff@example.com', password: 'hunter22' };
      const created = { id: '2', username: 'newstaff', email: 'staff@example.com', is_active: true, created_at: 'x', updated_at: 'x' };
      post.mockReturnValue(mockJsonResponse(created));

      const result = await AdminService.createUser(input);

      expect(post).toHaveBeenCalledWith('rbac/users', { json: input });
      expect(result).toEqual(created);
    });
  });

  describe('getUserRolesAndPermissions', () => {
    it('calls GET rbac/users/<userId>', async () => {
      const response = { user: { id: '2', username: 'newstaff', email: 'x', is_active: true, created_at: 'x', updated_at: 'x' }, roles: [], permissions: [] };
      get.mockReturnValue(mockJsonResponse(response));

      const result = await AdminService.getUserRolesAndPermissions('2');

      expect(get).toHaveBeenCalledWith('rbac/users/2');
      expect(result).toEqual(response);
    });
  });

  describe('updateUser', () => {
    it('patches rbac/users/<userId> with the input as json', async () => {
      const input = { full_name: 'Updated Name' };
      const updated = { id: '2', username: 'newstaff', email: 'x', full_name: 'Updated Name', is_active: true, created_at: 'x', updated_at: 'x' };
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await AdminService.updateUser('2', input);

      expect(patch).toHaveBeenCalledWith('rbac/users/2', { json: input });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteUser', () => {
    it('calls DELETE rbac/users/<userId>', async () => {
      del.mockReturnValue(Promise.resolve(undefined));

      await AdminService.deleteUser('2');

      expect(del).toHaveBeenCalledWith('rbac/users/2');
    });
  });

  describe('getSystemSettings', () => {
    it('calls GET settings', async () => {
      const settings = [{ id: 1, key: 'timezone', value: 'Asia/Kuala_Lumpur', created_at: 'x', updated_at: 'x' }];
      get.mockReturnValue(mockJsonResponse(settings));

      const result = await AdminService.getSystemSettings();

      expect(get).toHaveBeenCalledWith('settings');
      expect(result).toEqual(settings);
    });
  });

  describe('updateSystemSetting', () => {
    it('patches settings/<key> with the value as json', async () => {
      const updated = { id: 1, key: 'timezone', value: 'UTC', created_at: 'x', updated_at: 'x' };
      patch.mockReturnValue(mockJsonResponse(updated));

      const result = await AdminService.updateSystemSetting('timezone', 'UTC');

      expect(patch).toHaveBeenCalledWith('settings/timezone', { json: { value: 'UTC' } });
      expect(result).toEqual(updated);
    });
  });
});
