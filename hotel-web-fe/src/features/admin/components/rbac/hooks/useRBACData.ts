import { useCallback, useMemo, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission, RbacSnapshot, Role, User } from '../../../../../types';
import type { PermissionCategory, RolePermissionMap, RoleWithStats } from '../types';
import { PERMISSION_CATEGORIES, NAVIGATION_ITEMS } from '../constants';
import { rbacQueryKeys, useRbacSnapshot } from './useRBACQueries';

interface UserWithRoles extends User {
  roles?: Role[];
}

interface UseRBACDataReturn {
  // Data
  roles: Role[];
  permissions: Permission[];
  rolePermissions: Record<number, Permission[]>;
  users: UserWithRoles[];

  // Computed
  rolesWithStats: RoleWithStats[];
  permissionCategories: PermissionCategory[];
  rolePermissionMap: RolePermissionMap;

  // State
  loading: boolean;
  error: string | null;

  // Actions
  reload: () => Promise<void>;
  setRoles: (nextRoles: SetStateAction<Role[]>) => void;
  setPermissions: (nextPermissions: SetStateAction<Permission[]>) => void;
  setUsers: (nextUsers: SetStateAction<UserWithRoles[]>) => void;
  updateRolePermissions: (roleId: number, permissions: Permission[]) => void;
  updateUserRoles: (userId: string, roleIds: number[]) => void;
}

function applyStateAction<T>(current: T, action: SetStateAction<T>): T {
  return typeof action === 'function'
    ? (action as (previous: T) => T)(current)
    : action;
}

function toSnapshotUser(user: UserWithRoles): User {
  const { roles: _roles, ...snapshotUser } = user;
  return snapshotUser;
}

export function useRBACData(): UseRBACDataReturn {
  const queryClient = useQueryClient();
  const snapshotQuery = useRbacSnapshot();
  const snapshot = snapshotQuery.data;
  const { refetch } = snapshotQuery;

  const roles = snapshot?.roles || [];
  const permissions = snapshot?.permissions || [];

  const rolePermissions = useMemo<Record<number, Permission[]>>(() => {
    const permissionsById = new Map(permissions.map((permission) => [permission.id, permission]));
    const nextRolePermissions: Record<number, Permission[]> = {};

    roles.forEach((role) => {
      nextRolePermissions[role.id] = [];
    });

    snapshot?.role_permissions.forEach(({ role_id, permission_id }) => {
      const permission = permissionsById.get(permission_id);
      if (permission) {
        (nextRolePermissions[role_id] ||= []).push(permission);
      }
    });

    return nextRolePermissions;
  }, [permissions, roles, snapshot?.role_permissions]);

  const users = useMemo<UserWithRoles[]>(() => {
    if (!snapshot) return [];

    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const rolesByUser = new Map<string, Role[]>();

    snapshot.user_roles.forEach(({ user_id, role_id }) => {
      const role = rolesById.get(role_id);
      if (!role) return;

      const key = String(user_id);
      const userRoles = rolesByUser.get(key) || [];
      userRoles.push(role);
      rolesByUser.set(key, userRoles);
    });

    return snapshot.users.map((user) => ({
      ...user,
      roles: rolesByUser.get(String(user.id)) || [],
    }));
  }, [roles, snapshot]);

  const updateSnapshot = useCallback(
    (updater: (snapshot: RbacSnapshot) => RbacSnapshot) => {
      queryClient.setQueryData<RbacSnapshot>(rbacQueryKeys.snapshot(), (current) => {
        if (!current) return current;
        return updater(current);
      });
    },
    [queryClient]
  );

  const setRoles = useCallback((nextRoles: SetStateAction<Role[]>) => {
    updateSnapshot((current) => ({
      ...current,
      roles: applyStateAction(current.roles, nextRoles),
    }));
  }, [updateSnapshot]);

  const setPermissions = useCallback((nextPermissions: SetStateAction<Permission[]>) => {
    updateSnapshot((current) => ({
      ...current,
      permissions: applyStateAction(current.permissions, nextPermissions),
    }));
  }, [updateSnapshot]);

  const setUsers = useCallback((nextUsers: SetStateAction<UserWithRoles[]>) => {
    updateSnapshot((current) => {
      const currentUsers = current.users.map((user) => ({
        ...user,
        roles: users.find((derivedUser) => derivedUser.id === user.id)?.roles || [],
      }));
      const updatedUsers = applyStateAction(currentUsers, nextUsers);

      return {
        ...current,
        users: updatedUsers.map(toSnapshotUser),
      };
    });
  }, [updateSnapshot, users]);

  // Update role permissions helper
  const updateRolePermissions = useCallback((roleId: number, nextPermissions: Permission[]) => {
    updateSnapshot((current) => ({
      ...current,
      role_permissions: [
        ...current.role_permissions.filter((assignment) => assignment.role_id !== roleId),
        ...nextPermissions.map((permission) => ({
          role_id: roleId,
          permission_id: permission.id,
        })),
      ],
    }));
  }, [updateSnapshot]);

  // Update user roles helper
  const updateUserRoles = useCallback((userId: string, roleIds: number[]) => {
    updateSnapshot((current) => ({
      ...current,
      user_roles: [
        ...current.user_roles.filter((assignment) => String(assignment.user_id) !== String(userId)),
        ...roleIds.map((roleId) => ({
          user_id: userId,
          role_id: roleId,
        })),
      ],
    }));
  }, [updateSnapshot]);

  // Compute role-permission map for quick lookups
  const rolePermissionMap = useMemo<RolePermissionMap>(() => {
    const map: RolePermissionMap = {};

    roles.forEach(role => {
      const perms = rolePermissions[role.id] || [];
      map[role.id] = new Set(perms.map(p => p.id));
    });

    return map;
  }, [roles, rolePermissions]);

  // Group permissions by category
  const permissionCategories = useMemo<PermissionCategory[]>(() => {
    const grouped: Record<string, Permission[]> = {};

    permissions.forEach(permission => {
      // Extract category from resource (e.g., "navigation:timeline" -> "navigation")
      let category = permission.resource;
      if (permission.resource.includes(':')) {
        category = permission.resource.split(':')[0];
      }

      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(permission);
    });

    // Convert to array with metadata
    return Object.entries(grouped)
      .map(([name, perms]) => ({
        name,
        displayName: PERMISSION_CATEGORIES[name]?.displayName || name.charAt(0).toUpperCase() + name.slice(1),
        icon: PERMISSION_CATEGORIES[name]?.icon || 'VpnKey',
        color: PERMISSION_CATEGORIES[name]?.color || '#9e9e9e',
        permissions: perms.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [permissions]);

  // Compute roles with stats
  const rolesWithStats = useMemo<RoleWithStats[]>(() => {
    const navigationItemIds = new Set(NAVIGATION_ITEMS.map(item => item.id));

    return roles.map(role => {
      const perms = rolePermissions[role.id] || [];

      // Count navigation permissions
      const navPerms = perms.filter(p => p.resource.startsWith('navigation:'));

      // Get navigation item IDs from permissions
      const navItems = navPerms
        .map(p => p.resource.replace('navigation:', ''))
        .filter(id => navigationItemIds.has(id));

      return {
        ...role,
        permissionCount: perms.length,
        navigationCount: navItems.length,
        permissions: perms,
        navigationItems: navItems,
      };
    });
  }, [roles, rolePermissions]);

  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    roles,
    permissions,
    rolePermissions,
    users,
    rolesWithStats,
    permissionCategories,
    rolePermissionMap,
    loading: snapshotQuery.isLoading,
    error: snapshotQuery.error instanceof Error ? snapshotQuery.error.message : null,
    reload,
    setRoles,
    setPermissions,
    setUsers,
    updateRolePermissions,
    updateUserRoles,
  };
}
