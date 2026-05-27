import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AdminService,
  type CreateRbacUserInput,
  type UpdateRbacUserInput,
} from '../../../../../api/admin.service';
import type {
  RoleInput,
  RolePermissionIdsInput,
  UserRoleIdsInput,
} from '../../../../../types';

const rbacRootQueryKey = ['rbac'] as const;
const RBAC_STALE_TIME_MS = 5 * 60_000;

export const rbacQueryKeys = {
  all: rbacRootQueryKey,
  snapshot: () => [...rbacRootQueryKey, 'snapshot'] as const,
  roles: () => [...rbacRootQueryKey, 'roles'] as const,
  permissions: () => [...rbacRootQueryKey, 'permissions'] as const,
  users: () => [...rbacRootQueryKey, 'users'] as const,
  user: (userId: string) => [...rbacRootQueryKey, 'users', userId] as const,
};

function invalidateRbacQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: rbacQueryKeys.all });
}

export function useRbacSnapshot() {
  return useQuery({
    queryKey: rbacQueryKeys.snapshot(),
    queryFn: () => AdminService.getRbacSnapshot(),
    staleTime: RBAC_STALE_TIME_MS,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: rbacQueryKeys.roles(),
    queryFn: () => AdminService.getAllRoles(),
    staleTime: RBAC_STALE_TIME_MS,
  });
}

export function usePermissions() {
  return useQuery({
    queryKey: rbacQueryKeys.permissions(),
    queryFn: () => AdminService.getAllPermissions(),
    staleTime: RBAC_STALE_TIME_MS,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: rbacQueryKeys.users(),
    queryFn: () => AdminService.getAllUsers(),
    staleTime: RBAC_STALE_TIME_MS,
  });
}

export function useUser(userId?: string) {
  return useQuery({
    queryKey: rbacQueryKeys.user(userId || 'unknown'),
    queryFn: () => AdminService.getUserRolesAndPermissions(userId!),
    enabled: Boolean(userId),
    staleTime: RBAC_STALE_TIME_MS,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RoleInput) => AdminService.createRole(input),
    onSuccess: () => invalidateRbacQueries(queryClient),
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleId, input }: { roleId: string; input: RoleInput }) =>
      AdminService.updateRole(roleId, input),
    onSuccess: () => invalidateRbacQueries(queryClient),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roleId: string) => AdminService.deleteRole(roleId),
    onSuccess: () => invalidateRbacQueries(queryClient),
  });
}

export function useReplaceRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleId, input }: { roleId: string; input: RolePermissionIdsInput }) =>
      AdminService.replaceRolePermissions(roleId, input),
    onSuccess: () => invalidateRbacQueries(queryClient),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRbacUserInput) => AdminService.createUser(input),
    onSuccess: () => invalidateRbacQueries(queryClient),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateRbacUserInput }) =>
      AdminService.updateUser(userId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: rbacQueryKeys.user(variables.userId) });
      invalidateRbacQueries(queryClient);
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => AdminService.deleteUser(userId),
    onSuccess: (_data, userId) => {
      queryClient.removeQueries({ queryKey: rbacQueryKeys.user(userId) });
      invalidateRbacQueries(queryClient);
    },
  });
}

export function useReplaceUserRoles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UserRoleIdsInput }) =>
      AdminService.replaceUserRoles(userId, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: rbacQueryKeys.user(variables.userId) });
      invalidateRbacQueries(queryClient);
    },
  });
}
