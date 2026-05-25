import { useState, useEffect, useCallback, useMemo } from 'react';
import { HotelAPIService } from '../../../../../api';
import type { Role, Permission, User } from '../../../../../types';
import type { PermissionCategory, RolePermissionMap, RoleWithStats } from '../types';
import { PERMISSION_CATEGORIES, NAVIGATION_ITEMS } from '../constants';

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
  setRoles: React.Dispatch<React.SetStateAction<Role[]>>;
  setPermissions: React.Dispatch<React.SetStateAction<Permission[]>>;
  setUsers: React.Dispatch<React.SetStateAction<UserWithRoles[]>>;
  updateRolePermissions: (roleId: number, permissions: Permission[]) => void;
  updateUserRoles: (userId: string, roleIds: number[]) => void;
}

export function useRBACData(): UseRBACDataReturn {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<number, Permission[]>>({});
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const snapshot = await HotelAPIService.getRbacSnapshot();
      const rolesById = new Map(snapshot.roles.map((role) => [role.id, role]));
      const permissionsById = new Map(snapshot.permissions.map((permission) => [permission.id, permission]));

      const rolePermsMap: Record<number, Permission[]> = {};
      snapshot.roles.forEach((role) => {
        rolePermsMap[role.id] = [];
      });
      snapshot.role_permissions.forEach(({ role_id, permission_id }) => {
        const permission = permissionsById.get(permission_id);
        if (permission) {
          (rolePermsMap[role_id] ||= []).push(permission);
        }
      });

      const rolesByUser = new Map<string, Role[]>();
      snapshot.user_roles.forEach(({ user_id, role_id }) => {
        const role = rolesById.get(role_id);
        if (!role) return;
        const key = String(user_id);
        const userRoles = rolesByUser.get(key) || [];
        userRoles.push(role);
        rolesByUser.set(key, userRoles);
      });

      setRoles(snapshot.roles);
      setPermissions(snapshot.permissions);
      setRolePermissions(rolePermsMap);
      setUsers(snapshot.users.map((user) => ({
        ...user,
        roles: rolesByUser.get(String(user.id)) || [],
      })));
    } catch (err: any) {
      setError(err.message || 'Failed to load RBAC data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update role permissions helper
  const updateRolePermissions = useCallback((roleId: number, perms: Permission[]) => {
    setRolePermissions(prev => ({
      ...prev,
      [roleId]: perms,
    }));
  }, []);

  // Update user roles helper
  const updateUserRoles = useCallback((userId: string, roleIds: number[]) => {
    setUsers(prev => prev.map(user => {
      if (user.id === userId) {
        const userRoles = roles.filter(r => roleIds.includes(r.id));
        return { ...user, roles: userRoles };
      }
      return user;
    }));
  }, [roles]);

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

  return {
    roles,
    permissions,
    rolePermissions,
    users,
    rolesWithStats,
    permissionCategories,
    rolePermissionMap,
    loading,
    error,
    reload: loadData,
    setRoles,
    setPermissions,
    setUsers,
    updateRolePermissions,
    updateUserRoles,
  };
}
