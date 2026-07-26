import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthService } from '../../../api/auth.service';
import { UsersService } from '../../../api/users.service';
import { queryKeys } from '../../../api/queryKeys';
import type { PasskeyInfo, UserProfile, UserProfileUpdate, UserSessionInfo } from '../../../types';

export function useProfileQuery() {
  return useQuery<UserProfile>({
    queryKey: queryKeys.profile.me(),
    queryFn: () => UsersService.getUserProfile(),
  });
}

export function usePasskeysQuery() {
  return useQuery<PasskeyInfo[]>({
    queryKey: queryKeys.profile.passkeys(),
    queryFn: () => AuthService.listPasskeys(),
  });
}

export function useSessionsQuery() {
  return useQuery<UserSessionInfo[]>({
    queryKey: queryKeys.profile.sessions(),
    queryFn: () => AuthService.listSessions(),
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UserProfileUpdate) => UsersService.updateUserProfile(data),
    onSuccess: profile => {
      queryClient.setQueryData(queryKeys.profile.me(), profile);
    },
  });
}

export function useUpdatePasswordMutation() {
  return useMutation({
    mutationFn: (data: { current_password: string; new_password: string }) =>
      UsersService.updatePassword(data),
  });
}

function usePasskeyMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.passkeys() });
    },
  });
}

export function useDeletePasskeyMutation() {
  return usePasskeyMutation((id: string) => AuthService.deletePasskey(id));
}

export function useRenamePasskeyMutation() {
  return usePasskeyMutation(({ id, deviceName }: { id: string; deviceName: string }) =>
    AuthService.updatePasskey(id, { device_name: deviceName })
  );
}

/**
 * Registration runs through `AuthContext.registerPasskey` (it owns the WebAuthn
 * ceremony), so this only refreshes the list afterwards.
 */
export function useRegisterPasskeyMutation(registerPasskey: (username: string) => Promise<unknown>) {
  return usePasskeyMutation((username: string) => registerPasskey(username));
}

export function useRevokeSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => AuthService.revokeSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.sessions() });
    },
  });
}
